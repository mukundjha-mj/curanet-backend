import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Helper types
type AuthenticatedRequest = Request & { user?: any };

/**
 * Generate a user-friendly Health ID
 * Format: HID-YYYY-XXXXXXXX (where X is alphanumeric)
 */
function generateHealthId(): string {
    const year = new Date().getFullYear();
    const randomString = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `HID-${year}-${randomString}`;
}

/**
 * Search patient by Health ID - for doctors and pharmacies
 */
export const searchPatientByHealthId = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { healthId } = req.params;
        const { user } = req;

        if (!user || !['doctor', 'pharmacy', 'admin'].includes(user.role)) {
            res.status(403).json({ message: 'Unauthorized. Only healthcare providers can search patients.' });
            return;
        }

        // Find patient by Health ID
        const patient = await prisma.user.findUnique({
            where: { healthId },
            select: {
                healthId: true,
                email: true,
                phone: true,
                role: true,
                status: true,
                isVerified: true,
                createdAt: true,
                updatedAt: true
            }
        });

        if (!patient) {
            res.status(404).json({ message: 'Patient not found with this Health ID' });
            return;
        }

        if (patient.role !== 'patient') {
            res.status(400).json({ message: 'Health ID does not belong to a patient' });
            return;
        }

        // Get extended health information
        const healthInfo = await prisma.healthProfile.findUnique({
            where: { userId: healthId },
            include: {
                user: {
                    select: {
                        healthId: true,
                        email: true,
                        phone: true,
                        role: true,
                        status: true
                    }
                }
            }
        });

        // Check if user has consent to access this patient's data
        const consentRecord = await prisma.consent.findFirst({
            where: {
                patientId: healthId,
                providerId: user.healthId,
                status: 'ACTIVE',
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: new Date() } }
                ]
            }
        });

        // Check if provider has consent to access
        const hasConsent = !!consentRecord;

        // Log the search attempt
        await prisma.healthIdAudit.create({
            data: {
                healthId,
                accessedBy: user.healthId,
                action: 'PATIENT_SEARCH',
                details: {
                    searchedBy: user.email,
                    searcherRole: user.role,
                    hasConsent,
                    timestamp: new Date().toISOString()
                }
            }
        });

        // Return different levels of information based on consent
        if (hasConsent) {
            res.json({
                patient: {
                    healthId: patient.healthId,
                    email: patient.email,
                    phone: patient.phone,
                    status: patient.status,
                    isVerified: patient.isVerified,
                    profile: {
                        displayName: healthInfo?.displayName,
                        dateOfBirth: healthInfo?.dateOfBirth,
                        gender: healthInfo?.gender,
                        bloodGroup: healthInfo?.bloodGroup,
                        allergies: healthInfo?.allergies,
                        medications: healthInfo?.medications,
                        emergencyContact: healthInfo?.emergencyContact,
                        emergencyPhone: healthInfo?.emergencyPhone,
                        address: healthInfo?.address
                    }
                },
                hasFullAccess: true,
                consentGranted: hasConsent
            });
        } else {
            // Limited information without consent
            res.json({
                patient: {
                    healthId: patient.healthId,
                    status: patient.status,
                    isVerified: patient.isVerified
                },
                hasFullAccess: false,
                message: 'Limited information available. Patient consent required for full access.'
            });
        }

    } catch (error: any) {
        console.error('Search patient error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Update patient information - for doctors and pharmacies with consent
 */
export const updatePatientInfo = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { healthId } = req.params;
        const { user } = req;
        const updateData = req.body;

        if (!user || !['doctor', 'pharmacy', 'admin'].includes(user.role)) {
            res.status(403).json({ message: 'Unauthorized. Only healthcare providers can update patient information.' });
            return;
        }

        // Check if provider has consent
        const healthInfo = await prisma.healthProfile.findUnique({
            where: { userId: healthId },
            select: {
                id: true,
                displayName: true,
                dateOfBirth: true,
                gender: true,
                bloodGroup: true,
                allergies: true,
                medications: true,
                emergencyContact: true,
                emergencyPhone: true,
                address: true,
                userId: true
            }
        });

        // Check if provider has consent to update
        const consentRecord = await prisma.consent.findFirst({
            where: {
                patientId: healthId,
                providerId: user.healthId,
                status: 'ACTIVE',
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: new Date() } }
                ]
            }
        });

        if (!healthInfo || !consentRecord) {
            res.status(403).json({ message: 'No valid consent found to update patient information' });
            return;
        }

        // Update allowed fields
        const allowedUpdates = {
            displayName: updateData.displayName,
            bloodGroup: updateData.bloodGroup,
            allergies: updateData.allergies,
            medications: updateData.medications,
            emergencyContact: updateData.emergencyContact,
            emergencyPhone: updateData.emergencyPhone
        };

        // Remove undefined values
        Object.keys(allowedUpdates).forEach(key =>
            (allowedUpdates as any)[key] === undefined && delete (allowedUpdates as any)[key]
        );

        const updatedHealth = await prisma.healthProfile.update({
            where: { userId: healthId },
            data: allowedUpdates
        });

        // Log the update
        await prisma.healthIdAudit.create({
            data: {
                healthId,
                accessedBy: user.healthId,
                action: 'PATIENT_INFO_UPDATE',
                details: {
                    updatedBy: user.email,
                    updatedFields: Object.keys(allowedUpdates),
                    timestamp: new Date().toISOString()
                }
            }
        });

        res.json({
            message: 'Patient information updated successfully',
            updatedFields: Object.keys(allowedUpdates)
        });

    } catch (error: any) {
        console.error('Update patient error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Add medical record for patient - for doctors
 */
export const addMedicalRecord = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { healthId } = req.params;
        const { user } = req;
        const { type, diagnosis, prescription, notes } = req.body;

        if (!user || user.role !== 'doctor') {
            res.status(403).json({ message: 'Only doctors can add medical records' });
            return;
        }

        // Find patient
        const patient = await prisma.user.findUnique({
            where: { healthId }
        });

        if (!patient) {
            res.status(404).json({ message: 'Patient not found' });
            return;
        }

        // Check consent
        const hasConsent = await prisma.consent.findFirst({
            where: {
                patientId: healthId,
                providerId: user.healthId,
                status: 'ACTIVE',
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: new Date() } }
                ]
            }
        });

        if (!hasConsent) {
            res.status(403).json({ message: 'No valid consent to add medical records' });
            return;
        }

        // Create encounter record
        const encounter = await prisma.encounter.create({
            data: {
                patientId: patient.healthId,
                providerId: user.healthId,
                type: type || 'consultation',
                startTime: new Date(),
                endTime: new Date(),
                createdById: user.healthId,
                createdByRole: user.role
            }
        });

        // Add observations if provided
        if (diagnosis || prescription || notes) {
            const observations = [];

            if (diagnosis) {
                observations.push({
                    patientId: patient.healthId,
                    providerId: user.healthId,
                    encounterId: encounter.id,
                    code: 'diagnosis',
                    value: { text: diagnosis },
                    createdById: user.healthId,
                    createdByRole: user.role
                });
            }

            if (prescription) {
                observations.push({
                    patientId: patient.healthId,
                    providerId: user.healthId,
                    encounterId: encounter.id,
                    code: 'prescription',
                    value: { medications: prescription },
                    createdById: user.healthId,
                    createdByRole: user.role
                });
            }

            if (notes) {
                observations.push({
                    patientId: patient.healthId,
                    providerId: user.healthId,
                    encounterId: encounter.id,
                    code: 'clinical_notes',
                    value: { notes },
                    createdById: user.healthId,
                    createdByRole: user.role
                });
            }

            await prisma.observation.createMany({
                data: observations
            });
        }

        // Log the record addition
        await prisma.healthIdAudit.create({
            data: {
                healthId,
                accessedBy: user.healthId,
                action: 'MEDICAL_RECORD_ADDED',
                details: {
                    encounterId: encounter.id,
                    addedBy: user.email,
                    recordType: type,
                    timestamp: new Date().toISOString()
                }
            }
        });

        res.json({
            message: 'Medical record added successfully',
            encounterId: encounter.id
        });

    } catch (error: any) {
        console.error('Add medical record error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Get patient's medical history - for doctors and pharmacies with consent
 */
export const getPatientHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { healthId } = req.params;
        const { user } = req;

        if (!user || !['doctor', 'pharmacy', 'admin'].includes(user.role)) {
            res.status(403).json({ message: 'Unauthorized access' });
            return;
        }

        // Find patient
        const patient = await prisma.user.findUnique({
            where: { healthId }
        });

        if (!patient) {
            res.status(404).json({ message: 'Patient not found' });
            return;
        }

        // Check consent
        const hasConsent = await prisma.consent.findFirst({
            where: {
                patientId: healthId,
                providerId: user.healthId,
                status: 'ACTIVE',
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: new Date() } }
                ]
            }
        });

        if (!hasConsent) {
            res.status(403).json({ message: 'No valid consent to access medical history' });
            return;
        }

        // Get encounters and observations
        const encounters = await prisma.encounter.findMany({
            where: { patientId: patient.healthId },
            include: {
                observations: true
            },
            orderBy: { startTime: 'desc' },
            take: 50 // Limit to last 50 encounters
        });

        // Log the access
        await prisma.healthIdAudit.create({
            data: {
                healthId,
                accessedBy: user.healthId,
                action: 'MEDICAL_HISTORY_ACCESS',
                details: {
                    accessedBy: user.email,
                    recordCount: encounters.length,
                    timestamp: new Date().toISOString()
                }
            }
        });

        res.json({
            patientHealthId: healthId,
            encounters,
            recordCount: encounters.length
        });

    } catch (error: any) {
        console.error('Get patient history error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export default {
    searchPatientByHealthId,
    updatePatientInfo,
    addMedicalRecord,
    getPatientHistory
};