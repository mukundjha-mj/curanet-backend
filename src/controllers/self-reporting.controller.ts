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

// Simple in-memory rate limiting (10 observations per hour per patient)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

const checkRateLimit = (userId: string): boolean => {
    const now = Date.now();
    const key = `self-report-${userId}`;
    const limit = rateLimitStore.get(key);
    
    if (!limit || now > limit.resetTime) {
        rateLimitStore.set(key, { count: 1, resetTime: now + 60 * 60 * 1000 }); // 1 hour
        return true;
    }
    
    if (limit.count >= 10) {
        return false;
    }
    
    limit.count++;
    return true;
};

// Patient Self-Recording Controllers

export const createSelfReportedObservation = async (req: AuthedRequest, res: Response) => {
    try {
        const actor = req.user!;
        const { 
            code, 
            value, 
            unit, 
            recordedAt,
            deviceMetadata,
            attachmentUrl,
            notes 
        } = req.body;

        if (!code || value === undefined) {
            return res.status(400).json({ 
                message: 'code and value are required' 
            });
        }

        // Only patients can self-report for themselves
        if (actor.role !== 'patient') {
            return res.status(403).json({ 
                message: 'Only patients can create self-reported observations' 
            });
        }

        // Check rate limit
        if (!checkRateLimit(actor.healthId)) {
            return res.status(429).json({
                message: 'Too many self-reported observations. Please wait before adding more.',
                retryAfter: '1 hour'
            });
        }

        // Enhanced observation data with self-reporting metadata
        const enhancedValue = {
            value: value,
            source: 'SELF_REPORTED',
            verificationStatus: 'UNVERIFIED',
            deviceMetadata: deviceMetadata || null,
            attachmentUrl: attachmentUrl || null,
            patientNotes: notes || null,
            recordedAt: recordedAt || new Date().toISOString(),
            isCritical: checkCriticalValue(code, value),
            category: determineCategory(code),
            priority: determinePriority(code, value)
        };

        const observation = await prisma.observation.create({
            data: {
                patientId: actor.healthId,
                providerId: actor.healthId, // Self-reported, so patient is also provider
                code,
                value: enhancedValue,
                unit,
                recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
                createdById: actor.healthId,
                createdByRole: 'patient'
            }
        });

        // Check for critical values and trigger alerts
        if (enhancedValue.isCritical) {
            await triggerCriticalValueAlert(actor.healthId, observation, enhancedValue);
        }

        // Log self-reporting action
        await logSelfReportingAction(actor.healthId, observation.id, 'CREATED');

        return res.status(201).json({ 
            observation,
            message: 'Self-reported observation created successfully',
            isCritical: enhancedValue.isCritical
        });

    } catch (error) {
        console.error('createSelfReportedObservation error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getSelfReportedObservations = async (req: AuthedRequest, res: Response) => {
    try {
        const { healthId } = req.params;
        const actor = req.user!;
        const { 
            limit = '20', 
            offset = '0', 
            status = 'all',
            dateFrom,
            dateTo
        } = req.query;

        // Access control
        if (actor.role === 'patient' && actor.healthId !== healthId) {
            return res.status(403).json({ 
                message: 'Patients can only view their own self-reported observations' 
            });
        }

        const where: any = { 
            patientId: healthId
        };

        // Add date filtering
        if (dateFrom || dateTo) {
            where.recordedAt = {};
            if (dateFrom) where.recordedAt.gte = new Date(dateFrom as string);
            if (dateTo) where.recordedAt.lte = new Date(dateTo as string);
        }

        const observations = await prisma.observation.findMany({
            where,
            orderBy: { recordedAt: 'desc' },
            take: parseInt(limit as string),
            skip: parseInt(offset as string)
        });

        // Filter for self-reported observations
        const selfReported = observations.filter(obs => {
            const obsData = obs.value as any;
            const matchesSource = obsData?.source === 'SELF_REPORTED';
            
            if (status === 'all') return matchesSource;
            if (status === 'unverified') return matchesSource && obsData?.verificationStatus === 'UNVERIFIED';
            if (status === 'verified') return matchesSource && obsData?.verificationStatus === 'VERIFIED';
            if (status === 'rejected') return matchesSource && obsData?.verificationStatus === 'REJECTED';
            
            return matchesSource;
        });

        // Enhance with verification metadata
        const enhancedObservations = selfReported.map(obs => {
            const obsData = obs.value as any;
            return {
                ...obs,
                source: obsData?.source || 'SELF_REPORTED',
                verificationStatus: obsData?.verificationStatus || 'UNVERIFIED',
                verifiedAt: obsData?.verifiedAt || null,
                verifiedByDoctorId: obsData?.verifiedByDoctorId || null,
                verificationNotes: obsData?.verificationNotes || null,
                isCritical: obsData?.isCritical || false,
                category: obsData?.category || 'OTHER',
                priority: obsData?.priority || 'NORMAL',
                deviceMetadata: obsData?.deviceMetadata || null,
                attachmentUrl: obsData?.attachmentUrl || null,
                patientNotes: obsData?.patientNotes || null
            };
        });

        return res.json({ 
            observations: enhancedObservations,
            total: selfReported.length,
            unverified: selfReported.filter(obs => (obs.value as any)?.verificationStatus === 'UNVERIFIED').length,
            verified: selfReported.filter(obs => (obs.value as any)?.verificationStatus === 'VERIFIED').length,
            rejected: selfReported.filter(obs => (obs.value as any)?.verificationStatus === 'REJECTED').length
        });

    } catch (error) {
        console.error('getSelfReportedObservations error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const verifyObservation = async (req: AuthedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const actor = req.user!;
        const { status, notes } = req.body;

        if (!['VERIFIED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ 
                message: 'Status must be VERIFIED or REJECTED' 
            });
        }

        // Only doctors can verify observations
        if (actor.role !== 'doctor') {
            return res.status(403).json({ 
                message: 'Only doctors can verify observations' 
            });
        }

        const observation = await prisma.observation.findUnique({
            where: { id }
        });

        if (!observation) {
            return res.status(404).json({ 
                message: 'Observation not found' 
            });
        }

        const obsData = observation.value as any;
        
        // Check if it's a self-reported observation
        if (obsData?.source !== 'SELF_REPORTED') {
            return res.status(400).json({ 
                message: 'Only self-reported observations can be verified' 
            });
        }

        // Update verification status
        const updatedValue = {
            ...obsData,
            verificationStatus: status,
            verifiedAt: new Date().toISOString(),
            verifiedByDoctorId: actor.healthId,
            verificationNotes: notes || null
        };

        const updatedObservation = await prisma.observation.update({
            where: { id },
            data: {
                value: updatedValue,
                updatedAt: new Date()
            }
        });

        // Log verification action
        await logVerificationAction(actor.healthId, id, status, notes);

        return res.json({ 
            observation: updatedObservation,
            message: `Observation ${status.toLowerCase()} successfully`
        });

    } catch (error) {
        console.error('verifyObservation error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getUnverifiedObservations = async (req: AuthedRequest, res: Response) => {
    try {
        const actor = req.user!;
        const { 
            limit = '50', 
            offset = '0',
            patientId 
        } = req.query;

        // Only doctors can access verification queue
        if (actor.role !== 'doctor') {
            return res.status(403).json({ 
                message: 'Only doctors can access verification queue' 
            });
        }

        const where: any = {};
        if (patientId) where.patientId = patientId;

        const observations = await prisma.observation.findMany({
            where,
            orderBy: { recordedAt: 'desc' },
            take: parseInt(limit as string),
            skip: parseInt(offset as string)
        });

        // Filter for unverified self-reported observations
        const unverified = observations.filter(obs => {
            const obsData = obs.value as any;
            return obsData?.source === 'SELF_REPORTED' && 
                   obsData?.verificationStatus === 'UNVERIFIED';
        }).map(obs => {
            const obsData = obs.value as any;
            return {
                ...obs,
                source: obsData?.source,
                verificationStatus: obsData?.verificationStatus,
                isCritical: obsData?.isCritical || false,
                category: obsData?.category || 'OTHER',
                priority: obsData?.priority || 'NORMAL',
                deviceMetadata: obsData?.deviceMetadata,
                attachmentUrl: obsData?.attachmentUrl,
                patientNotes: obsData?.patientNotes
            };
        });

        return res.json({ 
            observations: unverified,
            total: unverified.length,
            criticalCount: unverified.filter(obs => obs.isCritical).length
        });

    } catch (error) {
        console.error('getUnverifiedObservations error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// Helper Functions

const checkCriticalValue = (code: string, value: any): boolean => {
    const lowerCode = code.toLowerCase();
    
    if (typeof value === 'object') {
        // Blood pressure
        if (lowerCode.includes('blood pressure') || lowerCode.includes('bp')) {
            const systolic = value.systolic || 0;
            const diastolic = value.diastolic || 0;
            return systolic >= 180 || diastolic >= 120 || systolic <= 90;
        }
    } else {
        const numValue = parseFloat(value);
        if (isNaN(numValue)) return false;

        // Blood glucose
        if (lowerCode.includes('glucose') || lowerCode.includes('sugar')) {
            return numValue >= 400 || numValue <= 40;
        }
        
        // Heart rate
        if (lowerCode.includes('heart rate') || lowerCode.includes('pulse')) {
            return numValue >= 150 || numValue <= 40;
        }
        
        // Temperature
        if (lowerCode.includes('temperature')) {
            return numValue >= 104 || numValue <= 95;
        }
    }
    
    return false;
};

const determineCategory = (code: string): string => {
    const lowerCode = code.toLowerCase();
    
    if (lowerCode.includes('blood pressure') || lowerCode.includes('heart rate') || 
        lowerCode.includes('temperature') || lowerCode.includes('weight') ||
        lowerCode.includes('height') || lowerCode.includes('pulse')) {
        return 'VITALS';
    }
    
    if (lowerCode.includes('glucose') || lowerCode.includes('cholesterol') || 
        lowerCode.includes('blood') || lowerCode.includes('sugar')) {
        return 'LAB_RESULTS';
    }
    
    return 'OTHER';
};

const determinePriority = (code: string, value: any): string => {
    if (checkCriticalValue(code, value)) {
        return 'CRITICAL';
    }
    return 'NORMAL';
};

const triggerCriticalValueAlert = async (patientId: string, observation: any, obsData: any) => {
    console.log(`🚨 CRITICAL SELF-REPORTED VALUE ALERT:`);
    console.log(`Patient: ${patientId}`);
    console.log(`Observation: ${observation.code} = ${JSON.stringify(obsData.value)}`);
    console.log(`Time: ${new Date().toISOString()}`);
    
    // PRODUCTION: Implement alert notification system
    // Integrate with notification service to alert healthcare providers of critical values
    // - Send notification to patient's primary care doctor
    // - Send SMS/email alert to patient
    // - Log in emergency alert system
    // - Potentially trigger emergency contact notification
};

const logSelfReportingAction = async (userId: string, observationId: string, action: string) => {
    // Create audit log entry
    try {
        await prisma.auditLog.create({
            data: {
                userId,
                action: `SELF_REPORT_${action}`,
                resource: 'Observation',
                resourceId: observationId,
                details: {
                    source: 'self_reporting',
                    timestamp: new Date().toISOString()
                },
                timestamp: new Date()
            }
        });
    } catch (error) {
        console.error('Failed to log self-reporting action:', error);
    }
};

const logVerificationAction = async (doctorId: string, observationId: string, status: string, notes?: string) => {
    try {
        await prisma.auditLog.create({
            data: {
                userId: doctorId,
                action: `VERIFY_OBSERVATION_${status}`,
                resource: 'Observation', 
                resourceId: observationId,
                details: {
                    verificationStatus: status,
                    notes: notes || null,
                    timestamp: new Date().toISOString()
                },
                timestamp: new Date()
            }
        });
    } catch (error) {
        console.error('Failed to log verification action:', error);
    }
};

export default {
    createSelfReportedObservation,
    getSelfReportedObservations,
    verifyObservation,
    getUnverifiedObservations
};