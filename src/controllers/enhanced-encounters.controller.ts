import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type AuthedRequest = Request & { 
  user?: { 
    healthId: string; 
    role: string; 
  };
  consentId?: string;
};

// Complete Encounter-Centered Workflow Implementation
// Works with existing database structure using JSON fields for extended data

export const createEnhancedEncounter = async (req: AuthedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { 
      appointment_id,
      patient_health_id,
      doctor_id,
      facility_id,
      visit_type = 'OPD',
      start_time,
      chief_complaint,
      notes
    } = req.body;

    // Validate required fields per your specification
    if (!patient_health_id || !start_time) {
      return res.status(400).json({ 
        message: 'patient_health_id and start_time are required' 
      });
    }

    // Only doctors or authorized clinicians can create encounters
    if (actor.role !== 'doctor') {
      return res.status(403).json({ 
        message: 'Only doctors or authorized clinicians can create encounters' 
      });
    }

    // If appointment_id provided, verify appointment exists and is approved
    if (appointment_id) {
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointment_id }
      });
      
      if (!appointment) {
        return res.status(404).json({ message: 'Appointment not found' });
      }
      
      // Verify appointment.status == APPROVED/CONFIRMED and doctor matches
      if (!['CONFIRMED', 'APPROVED'].includes(appointment.status)) {
        return res.status(400).json({ 
          message: 'Appointment must be CONFIRMED to create encounter' 
        });
      }
      
      if (appointment.doctorId !== actor.healthId) {
        return res.status(403).json({ 
          message: 'Only the assigned doctor can create encounter from appointment' 
        });
      }
    }

    // Enhanced encounter data stored in notes field as JSON for compatibility
    const enhancedData = {
      appointment_id,
      facility_id,
      visit_type,
      chief_complaint,
      status: 'DRAFT',
      provenance: {
        user_agent: req.headers['user-agent'],
        ip_address: req.ip || req.connection.remoteAddress,
        created_at: new Date(),
        action: 'encounter_created'
      },
      originalNotes: notes
    };

    const enc = await prisma.encounter.create({
      data: {
        patientId: patient_health_id,
        providerId: doctor_id || actor.healthId,
        type: `${visit_type}_ENCOUNTER`,
        reason: chief_complaint || 'Enhanced encounter',
        startTime: new Date(start_time),
        endTime: null, // Always null for DRAFT encounters
        notes: JSON.stringify(enhancedData),
        createdById: actor.healthId,
        createdByRole: actor.role
      },
      include: {
        observations: true
      }
    });

    // Parse and return enhanced data
    const parsedNotes = JSON.parse(enc.notes || '{}');
    const enhancedEncounter = {
      ...enc,
      appointmentId: parsedNotes.appointmentId,
      facilityId: parsedNotes.facilityId,
      visitType: parsedNotes.visitType,
      chiefComplaint: parsedNotes.chiefComplaint,
      status: parsedNotes.status,
      originalNotes: parsedNotes.originalNotes,
      provenance: parsedNotes.provenance
    };

    return res.status(201).json({ encounter: enhancedEncounter });
  } catch (error) {
    console.error('createEnhancedEncounter error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateEnhancedEncounter = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const actor = req.user!;
    const { status, notes, endTime, chiefComplaint } = req.body;

    const encounter = await prisma.encounter.findUnique({
      where: { id }
    });

    if (!encounter) {
      return res.status(404).json({ message: 'Encounter not found' });
    }

    if (encounter.providerId !== actor.healthId && actor.role !== 'admin') {
      return res.status(403).json({ message: 'Only the assigned provider can update this encounter' });
    }

    // Parse existing enhanced data
    const existingData = JSON.parse(encounter.notes || '{}');
    
    // Update enhanced data
    const updatedData = {
      ...existingData,
      status: status || existingData.status,
      chiefComplaint: chiefComplaint || existingData.chiefComplaint,
      originalNotes: notes !== undefined ? notes : existingData.originalNotes,
      lastUpdated: new Date(),
      updatedBy: actor.healthId
    };

    const updatedEncounter = await prisma.encounter.update({
      where: { id },
      data: {
        reason: chiefComplaint || encounter.reason,
        endTime: endTime ? new Date(endTime) : (status === 'COMPLETED' && !encounter.endTime ? new Date() : encounter.endTime),
        notes: JSON.stringify(updatedData),
        updatedAt: new Date()
      },
      include: {
        observations: true
      }
    });

    // Parse and return enhanced data
    const parsedData = JSON.parse(updatedEncounter.notes || '{}');
    const enhancedResult = {
      ...updatedEncounter,
      appointmentId: parsedData.appointmentId,
      facilityId: parsedData.facilityId,
      visitType: parsedData.visitType,
      chiefComplaint: parsedData.chiefComplaint,
      status: parsedData.status,
      originalNotes: parsedData.originalNotes
    };

    return res.json({ encounter: enhancedResult });
  } catch (error) {
    console.error('updateEnhancedEncounter error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const convertAppointmentToEncounter = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params; // appointment id
    const actor = req.user!;
    const { chiefComplaint, visitType = 'OPD', notes } = req.body;

    if (actor.role !== 'doctor') {
      return res.status(403).json({ message: 'Only doctors can convert appointments to encounters' });
    }

    // Find the appointment
    const appointment = await prisma.appointment.findUnique({
      where: { id }
    });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    if (appointment.doctorId !== actor.healthId) {
      return res.status(403).json({ message: 'Only the assigned doctor can convert this appointment' });
    }

    if (appointment.status !== 'CONFIRMED') {
      return res.status(400).json({ message: 'Only confirmed appointments can be converted to encounters' });
    }

    // Check if encounter already exists for this appointment (stored in notes)
    const existingEncounters = await prisma.encounter.findMany({
      where: {
        patientId: appointment.patientId,
        providerId: appointment.doctorId
      }
    });

    // Check if any encounter has this appointmentId in notes
    const existingEncounter = existingEncounters.find(enc => {
      try {
        const data = JSON.parse(enc.notes || '{}');
        return data.appointmentId === id;
      } catch {
        return false;
      }
    });

    if (existingEncounter) {
      return res.status(400).json({ 
        message: 'Encounter already exists for this appointment',
        encounter: existingEncounter
      });
    }

    // Create enhanced encounter data
    const enhancedData = {
      appointmentId: id,
      facilityId: appointment.facilityId,
      visitType,
      chiefComplaint,
      status: 'DRAFT',
      convertedFromAppointment: true,
      appointmentData: {
        requestedTime: appointment.requestedTime,
        reasonForVisit: appointment.reasonForVisit,
        appointmentType: appointment.appointmentType
      },
      provenance: {
        convertedFromAppointment: true,
        appointmentId: id,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        timestamp: new Date()
      },
      originalNotes: notes
    };

    const encounter = await prisma.encounter.create({
      data: {
        patientId: appointment.patientId,
        providerId: appointment.doctorId,
        type: 'appointment_based',
        reason: chiefComplaint || appointment.reasonForVisit || 'Appointment consultation',
        startTime: new Date(),
        notes: JSON.stringify(enhancedData),
        createdById: actor.healthId,
        createdByRole: actor.role
      },
      include: {
        observations: true
      }
    });

    // Parse and return enhanced data
    const parsedData = JSON.parse(encounter.notes || '{}');
    const enhancedEncounter = {
      ...encounter,
      appointmentId: parsedData.appointmentId,
      appointment: parsedData.appointmentData,
      facilityId: parsedData.facilityId,
      visitType: parsedData.visitType,
      chiefComplaint: parsedData.chiefComplaint,
      status: parsedData.status,
      originalNotes: parsedData.originalNotes
    };

    return res.status(201).json({ encounter: enhancedEncounter });
  } catch (error) {
    console.error('convertAppointmentToEncounter error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const getEnhancedPatientEncounters = async (req: AuthedRequest, res: Response) => {
  try {
    const { healthId } = req.params;
    const actor = req.user!;
    const { limit = '10', offset = '0', status, visitType } = req.query;

    // Access control
    if (actor.role === 'patient' && actor.healthId !== healthId) {
      return res.status(403).json({ message: 'Patients can only view their own encounters' });
    }

    const encounters = await prisma.encounter.findMany({
      where: { patientId: healthId },
      orderBy: { startTime: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
      include: {
        observations: {
          take: 5,
          orderBy: { recordedAt: 'desc' }
        }
      }
    });

    // Parse and enhance each encounter
    const enhancedEncounters = encounters.map(enc => {
      try {
        const parsedData = JSON.parse(enc.notes || '{}');
        return {
          ...enc,
          appointmentId: parsedData.appointmentId,
          appointment: parsedData.appointmentData,
          facilityId: parsedData.facilityId,
          visitType: parsedData.visitType || 'OPD',
          chiefComplaint: parsedData.chiefComplaint,
          status: parsedData.status || 'COMPLETED',
          originalNotes: parsedData.originalNotes,
          convertedFromAppointment: parsedData.convertedFromAppointment
        };
      } catch {
        return {
          ...enc,
          visitType: 'OPD',
          status: 'COMPLETED',
          originalNotes: enc.notes
        };
      }
    });

    // Apply filters
    const filteredEncounters = enhancedEncounters.filter(enc => {
      if (status && enc.status !== status) return false;
      if (visitType && enc.visitType !== visitType) return false;
      return true;
    });

    const total = await prisma.encounter.count({ 
      where: { patientId: healthId }
    });

    return res.json({ 
      encounters: filteredEncounters, 
      total,
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        hasMore: total > parseInt(offset as string) + encounters.length
      }
    });
  } catch (error) {
    console.error('getEnhancedPatientEncounters error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Prescription management using observations table with special codes
export const createEncounterPrescription = async (req: AuthedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { 
      encounterId,
      patientId,
      medicationName,
      dosage,
      frequency,
      duration,
      instructions,
      status = 'ACTIVE'
    } = req.body;

    if (!patientId || !medicationName || !dosage || !frequency || !duration) {
      return res.status(400).json({ 
        message: 'patientId, medicationName, dosage, frequency, and duration are required' 
      });
    }

    if (actor.role !== 'doctor') {
      return res.status(403).json({ message: 'Only doctors can create prescriptions' });
    }

    // Store prescription as special observation
    const prescriptionData = {
      medicationName,
      dosage,
      frequency,
      duration,
      instructions,
      status,
      prescribedBy: actor.healthId,
      prescribedAt: new Date(),
      type: 'prescription'
    };

    const prescription = await prisma.observation.create({
      data: {
        encounterId,
        patientId,
        providerId: actor.healthId,
        code: 'PRESCRIPTION',
        value: prescriptionData,
        unit: 'prescription',
        recordedAt: new Date(),
        createdById: actor.healthId,
        createdByRole: actor.role
      },
      include: {
        encounter: true
      }
    });

    return res.status(201).json({ prescription });
  } catch (error) {
    console.error('createEncounterPrescription error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const getEncounterPrescriptions = async (req: AuthedRequest, res: Response) => {
  try {
    const { encounterId } = req.params;
    const actor = req.user!;

    const prescriptions = await prisma.observation.findMany({
      where: {
        encounterId,
        code: 'PRESCRIPTION'
      },
      orderBy: { recordedAt: 'desc' },
      include: {
        encounter: true
      }
    });

    return res.json({ prescriptions });
  } catch (error) {
    console.error('getEncounterPrescriptions error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const getPatientPrescriptions = async (req: AuthedRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    const actor = req.user!;
    const { status, limit = '20', offset = '0' } = req.query;

    // Access control
    if (actor.role === 'patient' && actor.healthId !== patientId) {
      return res.status(403).json({ message: 'Patients can only view their own prescriptions' });
    }

    const where: any = {
      patientId,
      code: 'PRESCRIPTION'
    };

    // Filter by status if provided
    if (status) {
      // This would require a more complex query with JSON filtering
      // For now, we'll filter in application logic
    }

    const prescriptions = await prisma.observation.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
      include: {
        encounter: true
      }
    });

    // Filter by status in application if needed
    const filteredPrescriptions = status 
      ? prescriptions.filter(p => {
          try {
            const data = p.value as any;
            return data.status === status;
          } catch {
            return true;
          }
        })
      : prescriptions;

    return res.json({ prescriptions: filteredPrescriptions });
  } catch (error) {
    console.error('getPatientPrescriptions error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// GET /api/encounters/:id - fetch encounter and embedded observations/prescriptions
export const getEnhancedEncounter = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const actor = req.user!;

    const encounter = await prisma.encounter.findUnique({
      where: { id },
      include: {
        observations: {
          orderBy: { recordedAt: 'desc' }
        }
      }
    });

    if (!encounter) {
      return res.status(404).json({ message: 'Encounter not found' });
    }

    // Check access permissions
    if (actor.role === 'patient' && encounter.patientId !== actor.healthId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Parse enhanced data
    let enhancedData: any = {};
    try {
      enhancedData = JSON.parse(encounter.notes || '{}');
    } catch (e) {
      enhancedData = {};
    }

    // Get prescriptions from observations
    const prescriptions = encounter.observations
      .filter(obs => {
        const obsData = obs.value as any;
        return obsData?.type === 'PRESCRIPTION';
      })
      .map(obs => {
        const obsData = obs.value as any;
        return {
          id: obs.id,
          ...obsData.prescription,
          observation_id: obs.id
        };
      });

    return res.json({
      encounter: {
        ...encounter,
        enhanced_data: enhancedData,
        prescriptions,
        status: enhancedData.status || 'DRAFT'
      }
    });
  } catch (error) {
    console.error('getEnhancedEncounter error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// GET /api/patients/:healthId/encounters - list with pagination, filters
export const listPatientEncounters = async (req: AuthedRequest, res: Response) => {
  try {
    const { healthId } = req.params;
    const actor = req.user!;
    const { 
      limit = '10', 
      offset = '0', 
      visit_type,
      status,
      date_from,
      date_to 
    } = req.body;

    // Determine patient ID
    let patientId = healthId;
    if (actor.role === 'patient') {
      patientId = actor.healthId; // Patients can only see their own
    } else if (!healthId) {
      return res.status(400).json({ 
        message: 'Patient health ID is required for non-patient users' 
      });
    }

    // Build where clause
    const where: any = { patientId };
    
    if (date_from || date_to) {
      where.startTime = {};
      if (date_from) where.startTime.gte = new Date(date_from);
      if (date_to) where.startTime.lte = new Date(date_to);
    }

    const encounters = await prisma.encounter.findMany({
      where,
      orderBy: { startTime: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
      include: {
        observations: {
          take: 3,
          orderBy: { recordedAt: 'desc' }
        }
      }
    });

    // Parse enhanced data and filter
    const enhancedEncounters = encounters
      .map(enc => {
        let enhancedData: any = {};
        try {
          enhancedData = JSON.parse(enc.notes || '{}');
        } catch (e) {
          enhancedData = {};
        }
        return { ...enc, enhanced_data: enhancedData };
      })
      .filter(enc => {
        if (visit_type && enc.enhanced_data?.visit_type !== visit_type) return false;
        if (status && enc.enhanced_data?.status !== status) return false;
        return true;
      });

    return res.json({ 
      encounters: enhancedEncounters,
      total: enhancedEncounters.length,
      filters: { visit_type, status, date_from, date_to }
    });
  } catch (error) {
    console.error('listPatientEncounters error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Add observation to encounter
export const addObservationToEncounter = async (req: AuthedRequest, res: Response) => {
  try {
    const { encounterId } = req.params;
    const actor = req.user!;
    const { code, value, unit, notes } = req.body;

    // Verify encounter exists and user has access
    const encounter = await prisma.encounter.findUnique({
      where: { id: encounterId }
    });

    if (!encounter) {
      return res.status(404).json({ message: 'Encounter not found' });
    }

    if (encounter.providerId !== actor.healthId && actor.role !== 'admin') {
      return res.status(403).json({ 
        message: 'Only the assigned clinician can add observations to this encounter' 
      });
    }

    // Create observation linked to encounter
    const observation = await prisma.observation.create({
      data: {
        encounterId,
        patientId: encounter.patientId,
        providerId: actor.healthId,
        code,
        value,
        unit,
        recordedAt: new Date(),
        createdById: actor.healthId,
        createdByRole: actor.role
      }
    });

    return res.status(201).json({ observation });
  } catch (error) {
    console.error('addObservationToEncounter error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export default {
  createEnhancedEncounter,
  updateEnhancedEncounter,
  getEnhancedEncounter,
  listPatientEncounters,
  convertAppointmentToEncounter,
  getEnhancedPatientEncounters,
  createEncounterPrescription,
  getEncounterPrescriptions,
  getPatientPrescriptions,
  addObservationToEncounter
};