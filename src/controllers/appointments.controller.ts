import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import AuditService from '../services/audit.service';

const prisma = new PrismaClient();

interface AuthenticatedRequest extends Request {
  user?: {
    healthId: string;
    email: string | null;
    role: string;
    status: string;
    tokenId: string;
  };
}

export class AppointmentsController {
  /**
   * Request Appointment
   * POST /api/appointments/request
   * Allows patients to request appointments with doctors
   */
  static async requestAppointment(req: AuthenticatedRequest, res: Response) {
    try {
      const {
        doctorId,
        facilityId,
        requestedTime,
        reasonForVisit,
        patientNotes,
        appointmentType = 'consultation',
        duration = 30
      } = req.body;
      
      const patientId = req.user?.healthId;

      if (!patientId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Validate required fields
      if (!doctorId || !requestedTime) {
        return res.status(400).json({ 
          error: 'Doctor ID and requested time are required' 
        });
      }

      // Validate patient role
      const patient = await prisma.user.findUnique({
        where: { healthId: patientId },
        include: { healthProfile: true }
      });

      if (!patient || patient.role !== 'patient') {
        return res.status(403).json({ error: 'Only patients can request appointments' });
      }

      // Validate doctor exists and is a doctor
      const doctor = await prisma.user.findUnique({
        where: { healthId: doctorId },
        include: { healthProfile: true }
      });

      if (!doctor || doctor.role !== 'doctor') {
        return res.status(400).json({ error: 'Invalid doctor ID' });
      }

      // Parse and validate requested time
      const appointmentTime = new Date(requestedTime);
      if (appointmentTime <= new Date()) {
        return res.status(400).json({ error: 'Appointment time must be in the future' });
      }

      // Check for conflicting appointments (same doctor, overlapping time)
      const startTime = appointmentTime;
      const endTime = new Date(appointmentTime.getTime() + (duration * 60 * 1000));
      
      const conflictingAppointment = await prisma.appointment.findFirst({
        where: {
          doctorId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          requestedTime: {
            gte: new Date(startTime.getTime() - (60 * 60 * 1000)), // 1 hour buffer
            lte: new Date(endTime.getTime() + (60 * 60 * 1000))
          }
        }
      });

      if (conflictingAppointment) {
        return res.status(409).json({ 
          error: 'Doctor has a conflicting appointment at this time',
          conflicting_appointment: {
            id: conflictingAppointment.id,
            time: conflictingAppointment.requestedTime
          }
        });
      }

      // Create appointment request
      const appointment = await prisma.appointment.create({
        data: {
          patientId,
          doctorId,
          facilityId,
          requestedTime: appointmentTime,
          reasonForVisit,
          patientNotes,
          appointmentType,
          duration,
          status: 'PENDING'
        },
        include: {
          patient: {
            include: { healthProfile: true }
          },
          doctor: {
            include: { healthProfile: true }
          }
        }
      });

      // Create notification for doctor
      await prisma.appointmentNotification.create({
        data: {
          appointmentId: appointment.id,
          recipientId: doctorId,
          type: 'APPOINTMENT_REQUESTED',
          message: `New appointment request from ${patient.healthProfile?.firstName} ${patient.healthProfile?.lastName} for ${appointmentTime.toLocaleString()}`
        }
      });

      // Log the appointment request
      await AuditService.logAction({
        actorId: patientId,
        actorRole: 'patient',
        action: 'APPOINTMENT_REQUESTED',
        resourceType: 'Appointment',
        resourceId: appointment.id,
        patientHealthId: patientId,
        metadata: {
          doctorId,
          requestedTime: appointmentTime.toISOString(),
          reasonForVisit,
          appointmentType
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(201).json({
        success: true,
        data: {
          appointment: {
            id: appointment.id,
            patientId: appointment.patientId,
            doctorId: appointment.doctorId,
            requestedTime: appointment.requestedTime,
            status: appointment.status,
            reasonForVisit: appointment.reasonForVisit,
            appointmentType: appointment.appointmentType,
            duration: appointment.duration,
            doctorNotes: appointment.doctorNotes,
            patientNotes: appointment.patientNotes,
            createdAt: appointment.createdAt,
            updatedAt: appointment.updatedAt,
            confirmedAt: appointment.confirmedAt,
            rejectedAt: appointment.rejectedAt,
            cancelledAt: appointment.cancelledAt,
            // Include nested structures
            doctor: appointment.doctor ? {
              healthId: appointment.doctor.healthId,
              email: appointment.doctor.email,
              healthProfile: appointment.doctor.healthProfile ? {
                firstName: appointment.doctor.healthProfile.firstName,
                lastName: appointment.doctor.healthProfile.lastName,
                displayName: appointment.doctor.healthProfile.displayName,
                phone: appointment.doctor.phone
              } : null
            } : null,
            patient: appointment.patient ? {
              healthId: appointment.patient.healthId,
              email: appointment.patient.email,
              healthProfile: appointment.patient.healthProfile ? {
                firstName: appointment.patient.healthProfile.firstName,
                lastName: appointment.patient.healthProfile.lastName,
                phone: appointment.patient.phone
              } : null
            } : null
          }
        },
        message: 'Appointment request submitted successfully'
      });

    } catch (error) {
      console.error('Error requesting appointment:', error);
      res.status(500).json({ error: 'Failed to request appointment' });
    }
  }

  /**
   * Get Doctor's Appointment Queue (Doctor/Admin)
   * GET /api/appointments/doctor
   * Shows appointments for the doctor (doctors see their own, admins see all)
   */
  static async getDoctorQueue(req: AuthenticatedRequest, res: Response) {
    try {
      const doctorId = req.user?.healthId;
      const { status, limit = 50, page = 1 } = req.query;

      if (!doctorId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Validate user role (doctor or admin)
      const user = await prisma.user.findUnique({
        where: { healthId: doctorId }
      });

      if (!user || !['doctor', 'admin'].includes(user.role)) {
        return res.status(403).json({ error: 'Only doctors and admins can access appointment queue' });
      }

      const skip = (Number(page) - 1) * Number(limit);

      // Build query based on user role
      const whereClause = user.role === 'admin' 
        ? { ...(status && status !== 'ALL' && { status: status as any }) }  // Admin sees all appointments
        : { doctorId, ...(status && status !== 'ALL' && { status: status as any }) }; // Doctor sees only their appointments

      const appointments = await prisma.appointment.findMany({
        where: whereClause,
        include: {
          patient: {
            include: { healthProfile: true }
          },
          doctor: {
            include: { healthProfile: true }
          }
        },
        orderBy: [
          { status: 'asc' }, // PENDING first
          { requestedTime: 'asc' }
        ],
        skip,
        take: Number(limit)
      });

      const totalCount = await prisma.appointment.count({
        where: whereClause
      });

      // Log queue access
      await AuditService.logAction({
        actorId: doctorId,
        actorRole: user.role,
        action: 'APPOINTMENT_QUEUE_VIEWED',
        resourceType: 'AppointmentQueue',
        resourceId: user.role === 'admin' ? 'all' : doctorId,
        patientHealthId: doctorId,
        metadata: {
          appointmentCount: appointments.length,
          status: status as string,
          scope: user.role === 'admin' ? 'all_appointments' : 'doctor_appointments'
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        data: {
          appointments: appointments.map(apt => ({
            id: apt.id,
            patientId: apt.patientId,
            doctorId: apt.doctorId,
            requestedTime: apt.requestedTime,
            status: apt.status,
            reasonForVisit: apt.reasonForVisit,
            patientNotes: apt.patientNotes,
            doctorNotes: apt.doctorNotes,
            appointmentType: apt.appointmentType,
            duration: apt.duration,
            createdAt: apt.createdAt,
            updatedAt: apt.updatedAt,
            confirmedAt: apt.confirmedAt,
            rejectedAt: apt.rejectedAt,
            cancelledAt: apt.cancelledAt,
            // Include nested patient structure that frontend expects
            patient: apt.patient ? {
              healthId: apt.patient.healthId,
              email: apt.patient.email,
              healthProfile: apt.patient.healthProfile ? {
                firstName: apt.patient.healthProfile.firstName,
                lastName: apt.patient.healthProfile.lastName,
                phone: apt.patient.phone
              } : null
            } : null,
            // Include doctor information when accessed by admin
            ...(user.role === 'admin' && apt.doctor && {
              doctor: {
                healthId: apt.doctor.healthId,
                email: apt.doctor.email,
                healthProfile: apt.doctor.healthProfile ? {
                  firstName: apt.doctor.healthProfile.firstName,
                  lastName: apt.doctor.healthProfile.lastName,
                  phone: apt.doctor.phone
                } : null
              }
            })
          })),
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: totalCount,
            pages: Math.ceil(totalCount / Number(limit))
          }
        }
      });

    } catch (error) {
      console.error('Error getting doctor queue:', error);
      res.status(500).json({ error: 'Failed to get appointment queue' });
    }
  }

  /**
   * Approve Appointment
   * POST /api/appointments/:id/approve
   * Allows doctors to approve pending appointments
   */
  static async approveAppointment(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { doctorNotes } = req.body;
      const doctorId = req.user?.healthId;

      if (!doctorId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Find and validate appointment
      const appointment = await prisma.appointment.findUnique({
        where: { id },
        include: {
          patient: { include: { healthProfile: true } },
          doctor: { include: { healthProfile: true } }
        }
      });

      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found' });
      }

      if (appointment.doctorId !== doctorId) {
        return res.status(403).json({ error: 'You can only approve your own appointments' });
      }

      if (appointment.status !== 'PENDING') {
        return res.status(400).json({ 
          error: `Cannot approve appointment with status: ${appointment.status}` 
        });
      }

      // Update appointment status
      const updatedAppointment = await prisma.appointment.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          doctorNotes,
          confirmedAt: new Date()
        },
        include: {
          patient: { include: { healthProfile: true } },
          doctor: { include: { healthProfile: true } }
        }
      });

      // Create notification for patient
      await prisma.appointmentNotification.create({
        data: {
          appointmentId: id,
          recipientId: appointment.patientId,
          type: 'APPOINTMENT_CONFIRMED',
          message: `Your appointment with Dr. ${appointment.doctor.healthProfile?.firstName} ${appointment.doctor.healthProfile?.lastName} on ${appointment.requestedTime.toLocaleString()} has been confirmed.`
        }
      });

      // Log the approval
      await AuditService.logAction({
        actorId: doctorId,
        actorRole: 'doctor',
        action: 'APPOINTMENT_APPROVED',
        resourceType: 'Appointment',
        resourceId: id,
        patientHealthId: appointment.patientId,
        metadata: {
          appointmentTime: appointment.requestedTime.toISOString(),
          doctorNotes
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        data: {
          appointment: {
            id: updatedAppointment.id,
            patientId: updatedAppointment.patientId,
            doctorId: updatedAppointment.doctorId,
            requestedTime: updatedAppointment.requestedTime,
            status: updatedAppointment.status,
            reasonForVisit: updatedAppointment.reasonForVisit,
            appointmentType: updatedAppointment.appointmentType,
            duration: updatedAppointment.duration,
            doctorNotes: updatedAppointment.doctorNotes,
            patientNotes: updatedAppointment.patientNotes,
            createdAt: updatedAppointment.createdAt,
            updatedAt: updatedAppointment.updatedAt,
            confirmedAt: updatedAppointment.confirmedAt,
            rejectedAt: updatedAppointment.rejectedAt,
            cancelledAt: updatedAppointment.cancelledAt,
            // Include nested structures
            doctor: updatedAppointment.doctor ? {
              healthId: updatedAppointment.doctor.healthId,
              email: updatedAppointment.doctor.email,
              healthProfile: updatedAppointment.doctor.healthProfile ? {
                firstName: updatedAppointment.doctor.healthProfile.firstName,
                lastName: updatedAppointment.doctor.healthProfile.lastName,
                displayName: updatedAppointment.doctor.healthProfile.displayName,
                phone: updatedAppointment.doctor.phone
              } : null
            } : null,
            patient: updatedAppointment.patient ? {
              healthId: updatedAppointment.patient.healthId,
              email: updatedAppointment.patient.email,
              healthProfile: updatedAppointment.patient.healthProfile ? {
                firstName: updatedAppointment.patient.healthProfile.firstName,
                lastName: updatedAppointment.patient.healthProfile.lastName,
                phone: updatedAppointment.patient.phone
              } : null
            } : null
          }
        },
        message: 'Appointment approved successfully'
      });

    } catch (error) {
      console.error('Error approving appointment:', error);
      res.status(500).json({ error: 'Failed to approve appointment' });
    }
  }

  /**
   * Reject Appointment
   * POST /api/appointments/:id/reject
   * Allows doctors to reject pending appointments
   */
  static async rejectAppointment(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { doctorNotes, reason } = req.body;
      const doctorId = req.user?.healthId;

      if (!doctorId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Find and validate appointment
      const appointment = await prisma.appointment.findUnique({
        where: { id },
        include: {
          patient: { include: { healthProfile: true } },
          doctor: { include: { healthProfile: true } }
        }
      });

      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found' });
      }

      if (appointment.doctorId !== doctorId) {
        return res.status(403).json({ error: 'You can only reject your own appointments' });
      }

      if (appointment.status !== 'PENDING') {
        return res.status(400).json({ 
          error: `Cannot reject appointment with status: ${appointment.status}` 
        });
      }

      // Update appointment status
      const updatedAppointment = await prisma.appointment.update({
        where: { id },
        data: {
          status: 'REJECTED',
          doctorNotes: doctorNotes || reason,
          rejectedAt: new Date()
        }
      });

      // Create notification for patient
      await prisma.appointmentNotification.create({
        data: {
          appointmentId: id,
          recipientId: appointment.patientId,
          type: 'APPOINTMENT_REJECTED',
          message: `Your appointment request with Dr. ${appointment.doctor.healthProfile?.firstName} ${appointment.doctor.healthProfile?.lastName} for ${appointment.requestedTime.toLocaleString()} has been rejected. ${reason ? `Reason: ${reason}` : ''}`
        }
      });

      // Log the rejection
      await AuditService.logAction({
        actorId: doctorId,
        actorRole: 'doctor',
        action: 'APPOINTMENT_REJECTED',
        resourceType: 'Appointment',
        resourceId: id,
        patientHealthId: appointment.patientId,
        metadata: {
          appointmentTime: appointment.requestedTime.toISOString(),
          reason: reason || doctorNotes
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        data: {
          appointment: {
            id: updatedAppointment.id,
            status: updatedAppointment.status,
            rejectedAt: updatedAppointment.rejectedAt,
            doctorNotes: updatedAppointment.doctorNotes
          }
        },
        message: 'Appointment rejected successfully'
      });

    } catch (error) {
      console.error('Error rejecting appointment:', error);
      res.status(500).json({ error: 'Failed to reject appointment' });
    }
  }

  /**
   * Cancel Appointment
   * POST /api/appointments/:id/cancel
   * Allows patients or doctors to cancel appointments
   */
  static async cancelAppointment(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { reason, notes } = req.body;
      const userId = req.user?.healthId;
      const userRole = req.user?.role;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Find appointment
      const appointment = await prisma.appointment.findUnique({
        where: { id },
        include: {
          patient: { include: { healthProfile: true } },
          doctor: { include: { healthProfile: true } }
        }
      });

      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found' });
      }

      // Check authorization (patient or doctor can cancel)
      if (appointment.patientId !== userId && appointment.doctorId !== userId) {
        return res.status(403).json({ error: 'You can only cancel your own appointments' });
      }

      if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) {
        return res.status(400).json({ 
          error: `Cannot cancel appointment with status: ${appointment.status}` 
        });
      }

      // Update appointment status
      const updatedAppointment = await prisma.appointment.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          notes: notes || reason,
          cancelledAt: new Date()
        }
      });

      // Create notification for the other party
      const notificationRecipientId = userId === appointment.patientId ? appointment.doctorId : appointment.patientId;
      const cancelledBy = userId === appointment.patientId ? 'patient' : 'doctor';
      const cancelledByName = userId === appointment.patientId 
        ? `${appointment.patient.healthProfile?.firstName} ${appointment.patient.healthProfile?.lastName}`
        : `Dr. ${appointment.doctor.healthProfile?.firstName} ${appointment.doctor.healthProfile?.lastName}`;

      await prisma.appointmentNotification.create({
        data: {
          appointmentId: id,
          recipientId: notificationRecipientId,
          type: 'APPOINTMENT_CANCELLED',
          message: `Your appointment on ${appointment.requestedTime.toLocaleString()} has been cancelled by ${cancelledByName}. ${reason ? `Reason: ${reason}` : ''}`
        }
      });

      // Log the cancellation
      await AuditService.logAction({
        actorId: userId,
        actorRole: userRole || 'unknown',
        action: 'APPOINTMENT_CANCELLED',
        resourceType: 'Appointment',
        resourceId: id,
        patientHealthId: appointment.patientId,
        metadata: {
          appointmentTime: appointment.requestedTime.toISOString(),
          cancelledBy,
          reason: reason || notes
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        data: {
          appointment: {
            id: updatedAppointment.id,
            status: updatedAppointment.status,
            cancelledAt: updatedAppointment.cancelledAt,
            notes: updatedAppointment.notes
          }
        },
        message: 'Appointment cancelled successfully'
      });

    } catch (error) {
      console.error('Error cancelling appointment:', error);
      res.status(500).json({ error: 'Failed to cancel appointment' });
    }
  }

  /**
   * Get Patient Appointments
   * GET /api/appointments/patient
   * Shows appointments for the patient
   */
  static async getPatientAppointments(req: AuthenticatedRequest, res: Response) {
    try {
      const patientId = req.user?.healthId;
      const { status, limit = 50, page = 1 } = req.query;

      if (!patientId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const skip = (Number(page) - 1) * Number(limit);

      const appointments = await prisma.appointment.findMany({
        where: {
          patientId,
          ...(status && status !== 'ALL' && { status: status as any })
        },
        include: {
          doctor: {
            include: { healthProfile: true }
          }
        },
        orderBy: [
          { requestedTime: 'desc' }
        ],
        skip,
        take: Number(limit)
      });

      const totalCount = await prisma.appointment.count({
        where: {
          patientId,
          ...(status && status !== 'ALL' && { status: status as any })
        }
      });

      res.status(200).json({
        success: true,
        data: {
          appointments: appointments.map(apt => ({
            id: apt.id,
            patientId: apt.patientId,
            doctorId: apt.doctorId,
            requestedTime: apt.requestedTime,
            status: apt.status,
            reasonForVisit: apt.reasonForVisit,
            appointmentType: apt.appointmentType,
            duration: apt.duration,
            doctorNotes: apt.doctorNotes,
            patientNotes: apt.patientNotes,
            createdAt: apt.createdAt,
            updatedAt: apt.updatedAt,
            confirmedAt: apt.confirmedAt,
            rejectedAt: apt.rejectedAt,
            cancelledAt: apt.cancelledAt,
            // Include the nested doctor structure that frontend expects
            doctor: apt.doctor ? {
              healthId: apt.doctor.healthId,
              email: apt.doctor.email,
              healthProfile: apt.doctor.healthProfile ? {
                firstName: apt.doctor.healthProfile.firstName,
                lastName: apt.doctor.healthProfile.lastName,
                displayName: apt.doctor.healthProfile.displayName,
                phone: apt.doctor.phone
              } : null
            } : null
          })),
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: totalCount,
            pages: Math.ceil(totalCount / Number(limit))
          }
        }
      });

    } catch (error) {
      console.error('Error getting patient appointments:', error);
      res.status(500).json({ error: 'Failed to get appointments' });
    }
  }

  /**
   * Get Appointment Details
   * GET /api/appointments/:id
   * Get detailed information about a specific appointment
   */
  static async getAppointmentDetails(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.healthId;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const appointment = await prisma.appointment.findUnique({
        where: { id },
        include: {
          patient: { include: { healthProfile: true } },
          doctor: { include: { healthProfile: true } }
        }
      });

      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found' });
      }

      // Check authorization
      if (appointment.patientId !== userId && appointment.doctorId !== userId) {
        return res.status(403).json({ error: 'You can only view your own appointments' });
      }

      res.status(200).json({
        success: true,
        data: {
          appointment: {
            id: appointment.id,
            patientId: appointment.patientId,
            patientName: `${appointment.patient.healthProfile?.firstName} ${appointment.patient.healthProfile?.lastName}`,
            patientPhone: appointment.patient.phone,
            doctorId: appointment.doctorId,
            doctorName: `Dr. ${appointment.doctor.healthProfile?.firstName} ${appointment.doctor.healthProfile?.lastName}`,
            requestedTime: appointment.requestedTime,
            status: appointment.status,
            reasonForVisit: appointment.reasonForVisit,
            patientNotes: appointment.patientNotes,
            doctorNotes: appointment.doctorNotes,
            appointmentType: appointment.appointmentType,
            duration: appointment.duration,
            createdAt: appointment.createdAt,
            confirmedAt: appointment.confirmedAt,
            rejectedAt: appointment.rejectedAt,
            cancelledAt: appointment.cancelledAt
          }
        }
      });

    } catch (error) {
      console.error('Error getting appointment details:', error);
      res.status(500).json({ error: 'Failed to get appointment details' });
    }
  }

  /**
   * Generate ICS Calendar File
   * GET /api/appointments/:id/ics
   * Generate downloadable calendar invite for confirmed appointments
   */
  static async generateICS(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.healthId;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const appointment = await prisma.appointment.findUnique({
        where: { id },
        include: {
          patient: { include: { healthProfile: true } },
          doctor: { include: { healthProfile: true } }
        }
      });

      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found' });
      }

      // Check authorization
      if (appointment.patientId !== userId && appointment.doctorId !== userId) {
        return res.status(403).json({ error: 'You can only download your own appointments' });
      }

      if (appointment.status !== 'CONFIRMED') {
        return res.status(400).json({ error: 'Only confirmed appointments can be downloaded' });
      }

      // Generate ICS content
      const startTime = appointment.requestedTime;
      const endTime = new Date(startTime.getTime() + (appointment.duration || 30) * 60 * 1000);
      
      const formatDate = (date: Date) => {
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      };

      const patientName = `${appointment.patient.healthProfile?.firstName} ${appointment.patient.healthProfile?.lastName}`;
      const doctorName = `Dr. ${appointment.doctor.healthProfile?.firstName} ${appointment.doctor.healthProfile?.lastName}`;

      const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CuraNet//Appointment//EN',
        'BEGIN:VEVENT',
        `UID:appointment-${appointment.id}@curanet.com`,
        `DTSTART:${formatDate(startTime)}`,
        `DTEND:${formatDate(endTime)}`,
        `SUMMARY:Medical Appointment - ${doctorName}`,
        `DESCRIPTION:Appointment between ${patientName} and ${doctorName}\\nReason: ${appointment.reasonForVisit || 'Medical consultation'}\\nType: ${appointment.appointmentType}${appointment.doctorNotes ? '\\nNotes: ' + appointment.doctorNotes : ''}`,
        `ORGANIZER:CN=${doctorName}:MAILTO:${appointment.doctor.email}`,
        `ATTENDEE:CN=${patientName}:MAILTO:${appointment.patient.email}`,
        `STATUS:CONFIRMED`,
        `CREATED:${formatDate(appointment.createdAt)}`,
        `LAST-MODIFIED:${formatDate(appointment.updatedAt)}`,
        'BEGIN:VALARM',
        'TRIGGER:-PT15M',
        'ACTION:DISPLAY',
        'DESCRIPTION:Appointment reminder',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      // Set headers for file download
      res.setHeader('Content-Type', 'text/calendar');
      res.setHeader('Content-Disposition', `attachment; filename="appointment-${appointment.id}.ics"`);
      
      res.status(200).send(icsContent);

    } catch (error) {
      console.error('Error generating ICS:', error);
      res.status(500).json({ error: 'Failed to generate calendar file' });
    }
  }

  /**
   * Search Doctors
   * GET /api/appointments/doctors
   * Search for doctors to book appointments with
   */
  static async searchDoctors(req: AuthenticatedRequest, res: Response) {
    try {
      const { search, limit = 20 } = req.query;

      // Build where clause for filtering
      const where: any = {
        role: 'doctor',
        status: 'active',
        isVerified: true
      };

      if (search) {
        where.OR = [
          { email: { contains: search as string, mode: 'insensitive' } },
          { healthId: { contains: search as string, mode: 'insensitive' } },
          {
            healthProfile: {
              OR: [
                { firstName: { contains: search as string, mode: 'insensitive' } },
                { lastName: { contains: search as string, mode: 'insensitive' } },
                { displayName: { contains: search as string, mode: 'insensitive' } }
              ]
            }
          }
        ];
      }

      const doctors = await prisma.user.findMany({
        where,
        select: {
          healthId: true,
          email: true,
          healthProfile: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true
            }
          }
        },
        take: Number(limit),
        orderBy: [
          { healthProfile: { firstName: 'asc' } },
          { healthProfile: { lastName: 'asc' } }
        ]
      });

      res.status(200).json({
        success: true,
        data: {
          doctors: doctors.filter(doctor => doctor.healthProfile) // Only return doctors with profiles
        }
      });

    } catch (error) {
      console.error('Error searching doctors:', error);
      res.status(500).json({ error: 'Failed to search doctors' });
    }
  }

  /**
   * Update Appointment (Admin/Doctor/Patient)
   * PUT /api/appointments/:id
   * Allows admins to update any appointment, doctors and patients to update their own appointments
   * Patients have limited update permissions (cannot change status, duration, or doctor notes)
   */
  static async updateAppointment(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.healthId;
      const userRole = req.user?.role;
      
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const {
        requestedTime,
        reasonForVisit,
        appointmentType,
        duration,
        notes,
        status
      } = req.body;

      // Find the appointment
      const appointment = await prisma.appointment.findUnique({
        where: { id },
        include: {
          patient: { include: { healthProfile: true } },
          doctor: { include: { healthProfile: true } }
        }
      });

      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found' });
      }

      // Check authorization - admin, doctor (own appointments), or patient (own appointments)
      if (userRole === 'admin') {
        // Admins can update any appointment
      } else if (userRole === 'doctor' && appointment.doctorId === userId) {
        // Doctors can update their own appointments
      } else if (userRole === 'patient' && appointment.patientId === userId) {
        // Patients can update their own appointments (limited fields)
      } else {
        return res.status(403).json({ error: 'You can only update your own appointments' });
      }

      // Prepare update data based on user role
      const updateData: any = {};
      
      if (userRole === 'patient') {
        // Patients can only update specific fields and cannot change status
        if (requestedTime) {
          // Patients can only reschedule to future times
          const newTime = new Date(requestedTime);
          if (newTime <= new Date()) {
            return res.status(400).json({ error: 'Appointment time must be in the future' });
          }
          updateData.requestedTime = newTime;
        }
        if (reasonForVisit !== undefined) updateData.reasonForVisit = reasonForVisit;
        if (appointmentType) updateData.appointmentType = appointmentType;
        // Patients cannot modify duration, doctor notes, or status
      } else {
        // Admins and doctors can update all fields
        if (requestedTime) updateData.requestedTime = new Date(requestedTime);
        if (reasonForVisit !== undefined) updateData.reasonForVisit = reasonForVisit;
        if (appointmentType) updateData.appointmentType = appointmentType;
        if (duration) updateData.duration = duration;
        if (notes !== undefined) updateData.doctorNotes = notes;
        if (status) updateData.status = status;
      }

      // Update timestamps based on status change
      if (status && status !== appointment.status) {
        switch (status) {
          case 'CONFIRMED':
            updateData.confirmedAt = new Date();
            break;
          case 'REJECTED':
            updateData.rejectedAt = new Date();
            break;
          case 'CANCELLED':
            updateData.cancelledAt = new Date();
            break;
        }
      }

      // Update the appointment
      const updatedAppointment = await prisma.appointment.update({
        where: { id },
        data: updateData,
        include: {
          patient: { include: { healthProfile: true } },
          doctor: { include: { healthProfile: true } }
        }
      });

      // Log the update
      await AuditService.logAction({
        actorId: userId,
        actorRole: userRole,
        action: 'APPOINTMENT_UPDATED',
        resourceType: 'Appointment',
        resourceId: id,
        patientHealthId: appointment.patientId,
        metadata: {
          changes: updateData,
          previousStatus: appointment.status,
          newStatus: status || appointment.status
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        data: {
          appointment: updatedAppointment,
          message: 'Appointment updated successfully'
        }
      });

    } catch (error) {
      console.error('Error updating appointment:', error);
      res.status(500).json({ error: 'Failed to update appointment' });
    }
  }

  /**
   * Reschedule Appointment (Admin/Doctor/Patient)
   * POST /api/appointments/:id/reschedule
   * Allows admins to reschedule any appointment, doctors and patients to reschedule their own appointments
   * When patients reschedule, status is set back to PENDING for doctor approval
   */
  static async rescheduleAppointment(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.healthId;
      const userRole = req.user?.role;
      
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { requestedTime, notes } = req.body;

      if (!requestedTime) {
        return res.status(400).json({ error: 'New appointment time is required' });
      }

      // Find the appointment
      const appointment = await prisma.appointment.findUnique({
        where: { id },
        include: {
          patient: { include: { healthProfile: true } },
          doctor: { include: { healthProfile: true } }
        }
      });

      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found' });
      }

      // Check authorization - admin, doctor (own appointments), or patient (own appointments)
      if (userRole === 'admin') {
        // Admins can reschedule any appointment
      } else if (userRole === 'doctor' && appointment.doctorId === userId) {
        // Doctors can reschedule their own appointments
      } else if (userRole === 'patient' && appointment.patientId === userId) {
        // Patients can reschedule their own appointments
      } else {
        return res.status(403).json({ error: 'You can only reschedule your own appointments' });
      }

      const newTime = new Date(requestedTime);
      if (newTime <= new Date()) {
        return res.status(400).json({ error: 'New appointment time must be in the future' });
      }

      // Check for conflicts with the new time
      const conflictingAppointment = await prisma.appointment.findFirst({
        where: {
          doctorId: appointment.doctorId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          id: { not: id }, // Exclude current appointment
          requestedTime: {
            gte: new Date(newTime.getTime() - (60 * 60 * 1000)), // 1 hour buffer
            lte: new Date(newTime.getTime() + ((appointment.duration || 30) * 60 * 1000) + (60 * 60 * 1000))
          }
        }
      });

      if (conflictingAppointment) {
        return res.status(409).json({ 
          error: 'Doctor has a conflicting appointment at the new time',
          conflicting_appointment: {
            id: conflictingAppointment.id,
            time: conflictingAppointment.requestedTime
          }
        });
      }

      // Update the appointment with new time
      const updateData: any = {
        requestedTime: newTime,
      };

      // Handle notes and status based on who is rescheduling
      if (userRole === 'patient') {
        // When patient reschedules, set status back to PENDING for doctor approval
        updateData.status = 'PENDING';
        if (notes) {
          updateData.patientNotes = notes;
        }
      } else {
        // When admin/doctor reschedules, automatically confirm
        updateData.status = 'CONFIRMED';
        if (notes) {
          updateData.doctorNotes = notes ? `${appointment.doctorNotes || ''}\n\nRescheduled: ${notes}`.trim() : appointment.doctorNotes;
        }
      }

      const updatedAppointment = await prisma.appointment.update({
        where: { id },
        data: updateData,
        include: {
          patient: { include: { healthProfile: true } },
          doctor: { include: { healthProfile: true } }
        }
      });

      // Create notification for the appropriate recipient
      const notificationRecipientId = userRole === 'patient' ? appointment.doctorId : appointment.patientId;
      const rescheduledBy = userRole === 'patient' ? 'patient' : 
                          userRole === 'doctor' ? 'doctor' : 'administrator';
      const rescheduledByName = userRole === 'patient' 
        ? `${appointment.patient.healthProfile?.firstName} ${appointment.patient.healthProfile?.lastName}`
        : userRole === 'doctor'
        ? `Dr. ${appointment.doctor.healthProfile?.firstName} ${appointment.doctor.healthProfile?.lastName}`
        : 'Administrator';

      const notificationType = userRole === 'patient' ? 'APPOINTMENT_REQUESTED' : 'APPOINTMENT_CONFIRMED';
      const notificationMessage = userRole === 'patient' 
        ? `${rescheduledByName} has requested to reschedule your appointment to ${newTime.toLocaleString()}. Please review and approve.`
        : `Your appointment has been rescheduled to ${newTime.toLocaleString()} by ${rescheduledByName}`;

      await prisma.appointmentNotification.create({
        data: {
          appointmentId: id,
          recipientId: notificationRecipientId,
          type: notificationType,
          message: notificationMessage
        }
      });

      // Log the reschedule
      await AuditService.logAction({
        actorId: userId,
        actorRole: userRole,
        action: 'APPOINTMENT_RESCHEDULED',
        resourceType: 'Appointment',
        resourceId: id,
        patientHealthId: appointment.patientId,
        metadata: {
          previousTime: appointment.requestedTime.toISOString(),
          newTime: newTime.toISOString(),
          notes
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        data: {
          appointment: updatedAppointment,
          message: 'Appointment rescheduled successfully'
        }
      });

    } catch (error) {
      console.error('Error rescheduling appointment:', error);
      res.status(500).json({ error: 'Failed to reschedule appointment' });
    }
  }
}