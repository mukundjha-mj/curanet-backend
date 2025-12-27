import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type AuthedRequest = Request & { 
  user?: { 
    healthId: string; 
    role: string; 
  };
  consentId?: string; // Set by consent middleware
};

// Encounters
export const createEncounter = async (req: AuthedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { patientId, type, reason, startTime, endTime, notes } = req.body;

    if (!patientId || !type || !startTime) {
      return res.status(400).json({ message: 'patientId, type, startTime are required' });
    }

    if (actor.role !== 'doctor') {
      return res.status(403).json({ message: 'Only doctors can create encounters' });
    }

    const enc = await prisma.encounter.create({
      data: {
        patientId,
        providerId: actor.healthId,
        type,
        reason,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : null,
        notes,
        createdById: actor.healthId,
        createdByRole: actor.role
      }
    });

    return res.status(201).json({ encounter: enc });
  } catch (error) {
    console.error('createEncounter error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateEncounter = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const actor = req.user!;
    const { notes, endTime } = req.body;

    // Find the encounter
    const encounter = await prisma.encounter.findUnique({
      where: { id }
    });

    if (!encounter) {
      return res.status(404).json({ message: 'Encounter not found' });
    }

    // Only the provider who created the encounter or admin can update
    if (encounter.providerId !== actor.healthId && actor.role !== 'admin') {
      return res.status(403).json({ message: 'Only the assigned provider can update this encounter' });
    }

    // Update with existing schema fields only
    const updates: any = {};
    if (notes !== undefined) updates.notes = notes;
    if (endTime) updates.endTime = new Date(endTime);

    const updatedEncounter = await prisma.encounter.update({
      where: { id },
      data: {
        ...updates,
        updatedAt: new Date()
      },
      include: {
        observations: true
      }
    });

    return res.json({ encounter: updatedEncounter });
  } catch (error) {
    console.error('updateEncounter error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const getEncounter = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const actor = req.user!;

    const enc = await prisma.encounter.findUnique({ 
      where: { id },
      include: {
        observations: true
      }
    });

    if (!enc) {
      return res.status(404).json({ message: 'Encounter not found' });
    }

    if (actor.role === 'patient' && enc.patientId !== actor.healthId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    return res.json({ encounter: enc });
  } catch (error) {
    console.error('getEncounter error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const listEncounters = async (req: AuthedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { patientId, limit = '10', offset = '0' } = req.body;
    console.log('listEncounters for actor:', actor.healthId, 'role:', actor.role, 'requested patientId:', patientId);

    let pid = patientId;
    if (actor.role === 'patient') {
      pid = actor.healthId; // Patient can only view their own encounters
    } else if (!patientId) {
      return res.status(400).json({ message: 'Patient ID is required for non-patient users' });
    }

    console.log('Using patientId:', pid);

    const encs = await prisma.encounter.findMany({
      where: { patientId: pid },
      orderBy: { startTime: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
      include: {
        observations: true  // Fetch all observations, not just 3
      }
    });

    return res.json({ encounters: encs });
  } catch (error) {
    console.error('listEncounters error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const convertAppointmentToEncounter = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params; // appointment id
    const actor = req.user!;
    const { chiefComplaint, visitType, notes } = req.body;

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

    // Note: appointment relation not implemented in current schema
    // This would need to be implemented when appointment_id field is added
    const existingEncounter = null; // FUTURE: Link encounters to appointments if appointmentId provided

    // Create the encounter using existing schema
    const encounter = await prisma.encounter.create({
      data: {
        patientId: appointment.patientId,
        providerId: appointment.doctorId,
        type: 'appointment_based',
        reason: appointment.reasonForVisit || chiefComplaint,
        startTime: new Date(),
        notes: `${notes || ''} (Converted from appointment: ${id})`,
        createdById: actor.healthId,
        createdByRole: actor.role
      },
      include: {
        observations: true
      }
    });

    return res.status(201).json({ encounter });
  } catch (error) {
    console.error('convertAppointmentToEncounter error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const getPatientEncounters = async (req: AuthedRequest, res: Response) => {
  try {
    const { healthId } = req.params;
    const actor = req.user!;
    const { limit = '10', offset = '0', status, visitType } = req.query;

    // Access control
    if (actor.role === 'patient' && actor.healthId !== healthId) {
      return res.status(403).json({ message: 'Patients can only view their own encounters' });
    }

    const where: any = { patientId: healthId };
    if (status) where.status = status;
    if (visitType) where.visitType = visitType;

    const encounters = await prisma.encounter.findMany({
      where,
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

    const total = await prisma.encounter.count({ where });

    return res.json({ 
      encounters, 
      total,
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        hasMore: total > parseInt(offset as string) + encounters.length
      }
    });
  } catch (error) {
    console.error('getPatientEncounters error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Note: Prescription functionality will be implemented when schema is updated
// For now, prescriptions can be stored in observation.value JSON field

export const createObservation = async (req: AuthedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { encounterId, patientId, code, value, unit } = req.body;

    if (!patientId || !code) {
      return res.status(400).json({ message: 'patientId and code are required' });
    }

    if (!['doctor', 'admin'].includes(actor.role)) {
      return res.status(403).json({ message: 'Only doctors can create observations' });
    }

    const obs = await prisma.observation.create({
      data: {
        encounterId: encounterId || null,
        patientId,
        providerId: actor.healthId,
        code,
        value,
        unit,
        recordedAt: new Date(),
        createdById: actor.healthId,
        createdByRole: actor.role
      }
    });

    return res.status(201).json({ observation: obs });
  } catch (error) {
    console.error('createObservation error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const getObservation = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const actor = req.user!;

    const obs = await prisma.observation.findUnique({ 
      where: { id },
      include: { encounter: true }
    });

    if (!obs) {
      return res.status(404).json({ message: 'Observation not found' });
    }

    if (actor.role === 'patient' && obs.patientId !== actor.healthId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    return res.json({ observation: obs });
  } catch (error) {
    console.error('getObservation error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const listObservations = async (req: AuthedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { patientId, encounterId, limit = '20', offset = '0' } = req.body;
    console.log('listObservations for actor:', actor.healthId, 'role:', actor.role, 'requested patientId:', patientId);

    let pid = patientId;
    if (actor.role === 'patient') {
      pid = actor.healthId; // Patient can only view their own observations
    } else if (!patientId) {
      return res.status(400).json({ message: 'Patient ID is required for non-patient users' });
    }

    console.log('Using patientId:', pid);

    const where: any = { patientId: pid };
    if (encounterId) where.encounterId = encounterId;

    const obs = await prisma.observation.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
      include: {
        encounter: {
          select: { id: true, type: true, startTime: true }
        }
      }
    });

    return res.json({ observations: obs });
  } catch (error) {
    console.error('listObservations error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export default {
  createEncounter,
  getEncounter,
  listEncounters,
  createObservation,
  getObservation,
  listObservations
};