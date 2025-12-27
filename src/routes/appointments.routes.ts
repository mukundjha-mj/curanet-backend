import express from 'express';
import { AppointmentsController } from '../controllers/appointments.controller';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = express.Router();

// Search endpoints
router.get('/doctors', authenticateToken, AppointmentsController.searchDoctors);

// Patient endpoints
router.post('/request', authenticateToken, AppointmentsController.requestAppointment);
router.get('/patient', authenticateToken, AppointmentsController.getPatientAppointments);

// Doctor endpoints
router.get('/doctor', authenticateToken, AppointmentsController.getDoctorQueue);
router.post('/:id/approve', authenticateToken, AppointmentsController.approveAppointment);
router.post('/:id/reject', authenticateToken, AppointmentsController.rejectAppointment);

// Appointment management endpoints (admin, doctor, and patient can manage their own appointments)
router.put('/:id', authenticateToken, AppointmentsController.updateAppointment);
router.post('/:id/reschedule', authenticateToken, AppointmentsController.rescheduleAppointment);

// Shared endpoints (patient or doctor)
router.post('/:id/cancel', authenticateToken, AppointmentsController.cancelAppointment);
router.get('/:id', authenticateToken, AppointmentsController.getAppointmentDetails);
router.get('/:id/ics', authenticateToken, AppointmentsController.generateICS);

export default router;