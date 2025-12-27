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

// Enhanced Observations Controller with new features

export const createEnhancedObservation = async (req: AuthedRequest, res: Response) => {
    try {
        const actor = req.user!;
        const { 
            encounterId, 
            patientId, 
            code, 
            value, 
            unit,
            notes,
            referenceRange,
            // Enhanced clinical fields
            category,
            subcategory,
            doctorNotes,
            diagnosis,
            advice,
            status = 'ACTIVE',
            isPatientRecorded = false,
            attachedFiles = [],
            prescription
        } = req.body;

        if (!patientId || !code || !value) {
            return res.status(400).json({ message: 'patientId, code, and value are required' });
        }

        // Determine category and subcategory
        const obsCategory = category || determineCategory(code);
        const obsSubcategory = subcategory || determineSubcategory(code);
        
        // Check if critical based on value and reference range
        const isCritical = checkCriticalValue(value, referenceRange, code);
        const abnormalFlag = determineAbnormalFlag(value, referenceRange, code);
        const priority = isCritical ? 'CRITICAL' : determinePriority(abnormalFlag);
        
        // Store comprehensive enhanced data in JSON format
        const enhancedValue = {
            // Core measurement data
            value: value,
            unit: unit,
            referenceRange: referenceRange,
            
            // Clinical assessment
            category: obsCategory,
            subcategory: obsSubcategory,
            status: status,
            priority: priority,
            isCritical: isCritical,
            abnormalFlag: abnormalFlag,
            
            // Clinical notes and assessment
            notes: notes,
            doctorNotes: doctorNotes,
            diagnosis: diagnosis,
            advice: advice,
            
            // Audit and provenance
            isPatientRecorded: isPatientRecorded,
            verifiedBy: !isPatientRecorded ? actor.healthId : null,
            verifiedAt: !isPatientRecorded ? new Date() : null,
            recordedByName: await getProviderName(actor.healthId),
            
            // File attachments
            attachedFiles: attachedFiles,
            
            // Prescription link
            prescription: prescription || null,
            
            // Metadata
            createdAt: new Date(),
            updatedAt: new Date(),
            version: 1
        };

    const obs = await prisma.observation.create({
      data: {
        encounterId: encounterId || null,
        patientId,
        providerId: actor.healthId,
        code,
        value: enhancedValue,
        unit,
        createdById: actor.healthId,
        createdByRole: actor.role
      },
      include: {
        encounter: true
      }
    });    // Send critical alert if needed
    if (isCritical) {
      await sendCriticalAlert(patientId, obs);
    }        return res.status(201).json({ observation: obs });
    } catch (error) {
        console.error('createEnhancedObservation error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getObservationsByCategory = async (req: AuthedRequest, res: Response) => {
    try {
        const actor = req.user!;
        const { 
            patientId, 
            category, 
            subcategory,
            status,
            priority,
            dateFrom,
            dateTo,
            limit = '50', 
            offset = '0' 
        } = req.body;

        let pid = patientId;
        if (actor.role === 'patient') {
            pid = actor.healthId;
        } else if (!patientId) {
            return res.status(400).json({ message: 'Patient ID is required for non-patient users' });
        }

        const where: any = { patientId: pid };
        
        // Add date filtering if provided
        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) where.createdAt.gte = new Date(dateFrom);
            if (dateTo) where.createdAt.lte = new Date(dateTo);
        }

        const observations = await prisma.observation.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit),
            skip: parseInt(offset),
            include: {
                encounter: {
                    select: { id: true, type: true, startTime: true }
                }
            }
        });

        // Filter by enhanced criteria
        let filteredObservations = observations.filter(obs => {
            const obsData = obs.value as any;
            
            // Category filter
            if (category && category !== 'ALL' && obsData?.category !== category) {
                return false;
            }
            
            // Subcategory filter
            if (subcategory && obsData?.subcategory !== subcategory) {
                return false;
            }
            
            // Status filter
            if (status && obsData?.status !== status) {
                return false;
            }
            
            // Priority filter
            if (priority && obsData?.priority !== priority) {
                return false;
            }
            
            return true;
        });

        // Group observations by category for better organization
        const groupedByCategory = filteredObservations.reduce((acc: any, obs) => {
            const obsData = obs.value as any;
            const cat = obsData?.category || 'OTHER';
            
            if (!acc[cat]) {
                acc[cat] = {
                    category: cat,
                    count: 0,
                    criticalCount: 0,
                    observations: []
                };
            }
            
            acc[cat].count++;
            if (obsData?.isCritical) acc[cat].criticalCount++;
            acc[cat].observations.push(obs);
            
            return acc;
        }, {});

        return res.json({ 
            observations: filteredObservations,
            groupedByCategory,
            totalCount: filteredObservations.length,
            filters: { category, subcategory, status, priority, dateFrom, dateTo }
        });
    } catch (error) {
        console.error('getObservationsByCategory error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getObservationTrends = async (req: AuthedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { patientId, code, timeframe = '30' } = req.body;

    let pid = patientId;
    if (actor.role === 'patient') {
      pid = actor.healthId;
    } else if (!patientId) {
      return res.status(400).json({ message: 'Patient ID is required for non-patient users' });
    }

    const daysAgo = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000);

    const observations = await prisma.observation.findMany({
      where: {
        patientId: pid,
        code,
        createdAt: { gte: daysAgo }
      },
      orderBy: { createdAt: 'asc' }
    });

    // Extract values and calculate trends
    const values = observations.map(obs => {
      const obsData = obs.value as any;
      return extractNumericValue(obsData?.value || obsData);
    }).filter(v => v !== null) as number[];

    const stats = values.length > 0 ? {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a: number, b: number) => a + b, 0) / values.length,
      trend: calculateOverallTrend(values),
      totalReadings: values.length
    } : {
      min: 0,
      max: 0,
      avg: 0,
      trend: 'INSUFFICIENT_DATA',
      totalReadings: 0
    };

    return res.json({ trends: observations, stats });
  } catch (error) {
    console.error('getObservationTrends error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const getObservationAnalytics = async (req: AuthedRequest, res: Response) => {
    try {
        const actor = req.user!;
        const { patientId, timeframe = '90' } = req.body;

        let pid = patientId;
        if (actor.role === 'patient') {
            pid = actor.healthId;
        } else if (!patientId) {
            return res.status(400).json({ message: 'Patient ID is required for non-patient users' });
        }

        const daysAgo = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000);

        const observations = await prisma.observation.findMany({
            where: {
                patientId: pid,
                createdAt: { gte: daysAgo }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Calculate comprehensive analytics
        const analytics = {
            totalObservations: observations.length,
            categoriesBreakdown: {} as any,
            criticalAlerts: 0,
            trendAnalysis: {} as any,
            recentActivity: [] as any[],
            topConcerns: [] as any[]
        };

        // Process each observation
        observations.forEach(obs => {
            const obsData = obs.value as any;
            const category = obsData?.category || 'OTHER';
            
            // Category breakdown
            if (!analytics.categoriesBreakdown[category]) {
                analytics.categoriesBreakdown[category] = {
                    count: 0,
                    critical: 0,
                    lastRecorded: null
                };
            }
            
            analytics.categoriesBreakdown[category].count++;
            analytics.categoriesBreakdown[category].lastRecorded = obs.createdAt;
            
            if (obsData?.isCritical) {
                analytics.criticalAlerts++;
                analytics.categoriesBreakdown[category].critical++;
            }
        });

        // Recent activity (last 7 days)
        const recentDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        analytics.recentActivity = observations
            .filter(obs => new Date(obs.createdAt) >= recentDate)
            .slice(0, 10)
            .map(obs => {
                const obsData = obs.value as any;
                return {
                    id: obs.id,
                    code: obs.code,
                    category: obsData?.category,
                    isCritical: obsData?.isCritical,
                    recordedAt: obs.createdAt,
                    recordedBy: obsData?.recordedByName || 'Healthcare Provider'
                };
            });

        return res.json({ analytics });
    } catch (error) {
        console.error('getObservationAnalytics error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};export const addPrescriptionToObservation = async (req: AuthedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { observationId } = req.params;
    const { 
      medicationName,
      dosage,
      frequency,
      duration,
      instructions
    } = req.body;

    if (actor.role !== 'doctor') {
      return res.status(403).json({ message: 'Only doctors can prescribe medications' });
    }

    // Store prescription data in the observation's JSON value field
    const observation = await prisma.observation.findUnique({
      where: { id: observationId }
    });

    if (!observation) {
      return res.status(404).json({ message: 'Observation not found' });
    }

    const currentValue = observation.value as any;
    const updatedValue = {
      ...currentValue,
      prescription: {
        medicationName,
        dosage,
        frequency,
        duration,
        instructions,
        prescribedBy: actor.healthId,
        prescribedAt: new Date(),
        status: 'ACTIVE'
      }
    };

    const updatedObs = await prisma.observation.update({
      where: { id: observationId },
      data: { value: updatedValue }
    });

    return res.status(201).json({ observation: updatedObs });
  } catch (error) {
    console.error('addPrescriptionToObservation error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};export const updateObservationStatus = async (req: AuthedRequest, res: Response) => {
    try {
        const actor = req.user!;
        const { id } = req.params;
        const { status, doctorNotes, diagnosis, advice } = req.body;

    const currentObs = await prisma.observation.findUnique({
      where: { id }
    });

    if (!currentObs) {
      return res.status(404).json({ message: 'Observation not found' });
    }

    const currentValue = currentObs.value as any;
    const updatedValue = {
      ...currentValue,
      status,
      doctorNotes,
      diagnosis,
      advice,
      lastUpdatedBy: actor.healthId,
      lastUpdatedAt: new Date()
    };

    const observation = await prisma.observation.update({
      where: { id },
      data: {
        value: updatedValue
      },
      include: {
        encounter: true
      }
    });        return res.json({ observation });
    } catch (error) {
        console.error('updateObservationStatus error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getCriticalObservations = async (req: AuthedRequest, res: Response) => {
    try {
        const actor = req.user!;
        const { patientId } = req.body;

        let pid = patientId;
        if (actor.role === 'patient') {
            pid = actor.healthId;
        }

    const allObs = await prisma.observation.findMany({
      where: {
        patientId: pid
      },
      orderBy: { createdAt: 'desc' },
      include: {
        encounter: true
      }
    });

    // Filter for critical observations
    const criticalObs = allObs.filter(obs => {
      const obsData = obs.value as any;
      return obsData?.isCritical === true;
    });        return res.json({ criticalObservations: criticalObs });
    } catch (error) {
        console.error('getCriticalObservations error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getObservationAuditTrail = async (req: AuthedRequest, res: Response) => {
    try {
        const actor = req.user!;
        const { patientId, observationId, includeSystem = false } = req.body;

        let pid = patientId;
        if (actor.role === 'patient') {
            pid = actor.healthId;
        } else if (!patientId) {
            return res.status(400).json({ message: 'Patient ID is required for non-patient users' });
        }

        const where: any = { patientId: pid };
        if (observationId) where.id = observationId;

        const observations = await prisma.observation.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                encounter: {
                    select: { id: true, type: true, startTime: true }
                }
            }
        });

        // Create detailed audit trail
        const auditTrail = observations.map(obs => {
            const obsData = obs.value as any;
            
            return {
                observationId: obs.id,
                patientId: obs.patientId,
                code: obs.code,
                category: obsData?.category,
                
                // Audit information
                createdAt: obs.createdAt,
                updatedAt: obs.updatedAt,
                createdById: obs.createdById,
                createdByRole: obs.createdByRole,
                recordedByName: obsData?.recordedByName,
                
                // Verification status
                isPatientRecorded: obsData?.isPatientRecorded || false,
                verifiedBy: obsData?.verifiedBy,
                verifiedAt: obsData?.verifiedAt,
                
                // Clinical context
                isCritical: obsData?.isCritical || false,
                status: obsData?.status || 'ACTIVE',
                priority: obsData?.priority || 'NORMAL',
                
                // Related encounter
                encounterId: obs.encounterId,
                encounterType: obs.encounter?.type,
                
                // Version tracking
                version: obsData?.version || 1,
                
                // System metadata (if requested)
                ...(includeSystem && {
                    systemInfo: {
                        ipAddress: obsData?.systemInfo?.ipAddress,
                        userAgent: obsData?.systemInfo?.userAgent,
                        source: obsData?.systemInfo?.source
                    }
                })
            };
        });

        return res.json({ 
            auditTrail,
            summary: {
                totalRecords: auditTrail.length,
                patientRecorded: auditTrail.filter(a => a.isPatientRecorded).length,
                doctorRecorded: auditTrail.filter(a => !a.isPatientRecorded).length,
                criticalCount: auditTrail.filter(a => a.isCritical).length,
                verifiedCount: auditTrail.filter(a => a.verifiedBy).length
            }
        });
    } catch (error) {
        console.error('getObservationAuditTrail error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const exportObservations = async (req: AuthedRequest, res: Response) => {
    try {
        const actor = req.user!;
        const { patientId, format = 'JSON', category, dateFrom, dateTo } = req.body;

        let pid = patientId;
        if (actor.role === 'patient') {
            pid = actor.healthId;
        }

        const where: any = { patientId: pid };
        if (category) where.category = category;
        if (dateFrom) where.recordedAt = { gte: new Date(dateFrom) };
        if (dateTo) where.recordedAt = { ...where.recordedAt, lte: new Date(dateTo) };

    const observations = await prisma.observation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        encounter: true
      }
    });        if (format === 'FHIR') {
            const fhirBundle = convertToFHIR(observations);
            return res.json(fhirBundle);
        }

        return res.json({ observations, exportedAt: new Date() });
    } catch (error) {
        console.error('exportObservations error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// Helper Functions

const determineCategory = (code: string): string => {
    const lowerCode = code.toLowerCase();
    
    // Vitals
    if (lowerCode.includes('blood pressure') || lowerCode.includes('bp') || 
        lowerCode.includes('heart rate') || lowerCode.includes('pulse') ||
        lowerCode.includes('temperature') || lowerCode.includes('weight') ||
        lowerCode.includes('height') || lowerCode.includes('bmi') ||
        lowerCode.includes('spo2') || lowerCode.includes('oxygen saturation') ||
        lowerCode.includes('respiratory rate')) {
        return 'VITALS';
    }
    
    // Laboratory Results
    if (lowerCode.includes('glucose') || lowerCode.includes('sugar') ||
        lowerCode.includes('cholesterol') || lowerCode.includes('hemoglobin') ||
        lowerCode.includes('hba1c') || lowerCode.includes('creatinine') ||
        lowerCode.includes('thyroid') || lowerCode.includes('tsh') ||
        lowerCode.includes('vitamin') || lowerCode.includes('lipid') ||
        lowerCode.includes('liver function') || lowerCode.includes('kidney function')) {
        return 'LABORATORY';
    }
    
    // Imaging Reports
    if (lowerCode.includes('x-ray') || lowerCode.includes('mri') ||
        lowerCode.includes('ct scan') || lowerCode.includes('ultrasound') ||
        lowerCode.includes('ecg') || lowerCode.includes('echo') ||
        lowerCode.includes('mammogram') || lowerCode.includes('pet scan')) {
        return 'IMAGING';
    }
    
    // Lifestyle Observations
    if (lowerCode.includes('smoking') || lowerCode.includes('alcohol') ||
        lowerCode.includes('exercise') || lowerCode.includes('diet') ||
        lowerCode.includes('sleep') || lowerCode.includes('stress')) {
        return 'LIFESTYLE';
    }
    
    // Mental Health
    if (lowerCode.includes('depression') || lowerCode.includes('anxiety') ||
        lowerCode.includes('mood') || lowerCode.includes('mental')) {
        return 'MENTAL_HEALTH';
    }
    
    return 'OTHER';
};

const determineSubcategory = (code: string): string => {
    const lowerCode = code.toLowerCase();
    
    // Vitals subcategories
    if (lowerCode.includes('blood pressure') || lowerCode.includes('bp')) return 'Blood Pressure';
    if (lowerCode.includes('heart rate') || lowerCode.includes('pulse')) return 'Heart Rate';
    if (lowerCode.includes('temperature')) return 'Body Temperature';
    if (lowerCode.includes('weight')) return 'Body Weight';
    if (lowerCode.includes('height')) return 'Height';
    if (lowerCode.includes('bmi')) return 'Body Mass Index';
    if (lowerCode.includes('spo2') || lowerCode.includes('oxygen')) return 'Oxygen Saturation';
    
    // Lab subcategories
    if (lowerCode.includes('glucose') || lowerCode.includes('sugar')) return 'Blood Glucose';
    if (lowerCode.includes('cholesterol')) return 'Lipid Profile';
    if (lowerCode.includes('hemoglobin') || lowerCode.includes('hb')) return 'Complete Blood Count';
    if (lowerCode.includes('thyroid') || lowerCode.includes('tsh')) return 'Thyroid Function';
    if (lowerCode.includes('liver')) return 'Liver Function';
    if (lowerCode.includes('kidney') || lowerCode.includes('creatinine')) return 'Kidney Function';
    
    return 'General';
};

const determineAbnormalFlag = (value: any, referenceRange: any, code: string): string => {
    const lowerCode = code.toLowerCase();
    
    if (typeof value === 'object') {
        // Handle complex values like BP
        if (lowerCode.includes('blood pressure') || lowerCode.includes('bp')) {
            const systolic = value.systolic || 0;
            const diastolic = value.diastolic || 0;
            
            if (systolic >= 180 || diastolic >= 120) return 'CRITICAL';
            if (systolic >= 140 || diastolic >= 90) return 'HIGH';
            if (systolic < 90 || diastolic < 60) return 'LOW';
            return 'NORMAL';
        }
    } else {
        const numValue = parseFloat(value);
        if (isNaN(numValue)) return 'NORMAL';

        // Blood sugar
        if (lowerCode.includes('glucose') || lowerCode.includes('sugar')) {
            if (numValue >= 400) return 'CRITICAL';
            if (numValue >= 200) return 'HIGH';
            if (numValue <= 40) return 'CRITICAL';
            if (numValue <= 70) return 'LOW';
            return 'NORMAL';
        }
        
        // Heart rate
        if (lowerCode.includes('heart rate') || lowerCode.includes('pulse')) {
            if (numValue >= 150 || numValue <= 40) return 'CRITICAL';
            if (numValue >= 100) return 'HIGH';
            if (numValue <= 60) return 'LOW';
            return 'NORMAL';
        }
    }
    
    return 'NORMAL';
};

const determinePriority = (abnormalFlag: string): string => {
    switch (abnormalFlag) {
        case 'CRITICAL': return 'CRITICAL';
        case 'HIGH': case 'LOW': return 'HIGH';
        default: return 'NORMAL';
    }
};

const getProviderName = async (healthId: string): Promise<string> => {
    try {
        const user = await prisma.user.findUnique({
            where: { healthId },
            include: { healthProfile: true }
        });
        
        if (user?.healthProfile?.displayName) {
            return user.healthProfile.displayName;
        }
        
        return `Provider ${healthId.slice(-6)}`;
    } catch (error) {
        return `Provider ${healthId.slice(-6)}`;
    }
};

const checkCriticalValue = (value: any, referenceRange: any, code: string): boolean => {
    // Implement critical value detection logic
    const lowerCode = code.toLowerCase();

    if (typeof value === 'object') {
        // Handle complex values like BP
        if (lowerCode.includes('blood pressure') || lowerCode.includes('bp')) {
            const systolic = value.systolic || 0;
            const diastolic = value.diastolic || 0;
            return systolic >= 180 || diastolic >= 120 || systolic <= 70 || diastolic <= 40;
        }
    } else {
        const numValue = parseFloat(value);
        if (isNaN(numValue)) return false;

        // Blood sugar
        if (lowerCode.includes('glucose') || lowerCode.includes('sugar')) {
            return numValue >= 400 || numValue <= 40;
        }

        // Heart rate
        if (lowerCode.includes('heart rate') || lowerCode.includes('pulse')) {
            return numValue >= 150 || numValue <= 40;
        }

        // Temperature
        if (lowerCode.includes('temperature')) {
            return numValue >= 104 || numValue <= 95; // Fahrenheit
        }
    }

    return false;
};

const sendCriticalAlert = async (patientId: string, observation: any) => {
    // Implement critical alert notification
    console.log(`🚨 CRITICAL ALERT: Patient ${patientId} has critical observation: ${observation.code} = ${observation.value}`);
    // PRODUCTION: Implement notification service for anomaly alerts
};

const extractNumericValue = (value: any): number | null => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const num = parseFloat(value);
        return isNaN(num) ? null : num;
    }
    if (typeof value === 'object' && value !== null) {
        // Handle complex values - take the first numeric property
        for (const [key, val] of Object.entries(value)) {
            const num = parseFloat(val as string);
            if (!isNaN(num)) return num;
        }
    }
    return null;
};

const calculateOverallTrend = (values: number[]): string => {
    if (values.length < 2) return 'INSUFFICIENT_DATA';

    const first = values[0];
    const last = values[values.length - 1];
    const change = ((last - first) / first) * 100;

    if (Math.abs(change) < 5) return 'STABLE';
    return change > 0 ? 'INCREASING' : 'DECREASING';
};

const convertToFHIR = (observations: any[], patient?: any): any => {
    // Convert to FHIR R4 format with enhanced data
    return {
        resourceType: 'Bundle',
        id: `observations-bundle-${new Date().getTime()}`,
        type: 'collection',
        timestamp: new Date().toISOString(),
        total: observations.length,
        entry: observations.map(obs => {
            const obsData = obs.value as any;
            
            return {
                fullUrl: `urn:uuid:${obs.id}`,
                resource: {
                    resourceType: 'Observation',
                    id: obs.id,
                    status: (obsData?.status || 'final').toLowerCase(),
                    category: [{
                        coding: [{
                            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                            code: (obsData?.category || 'survey').toLowerCase().replace('_', '-'),
                            display: obsData?.category || 'Survey'
                        }]
                    }],
                    code: {
                        text: obs.code,
                        coding: [{
                            system: 'http://loinc.org',
                            code: generateLoincCode(obs.code),
                            display: obs.code
                        }]
                    },
                    subject: {
                        reference: `Patient/${obs.patientId}`,
                        display: patient?.healthProfile?.displayName || `Patient ${obs.patientId}`
                    },
                    effectiveDateTime: obs.createdAt,
                    issued: obs.createdAt,
                    performer: [{
                        reference: `Practitioner/${obs.createdById}`,
                        display: obsData?.recordedByName || 'Healthcare Provider'
                    }],
                    
                    // Value handling
                    ...(typeof obsData?.value === 'number' && {
                        valueQuantity: {
                            value: obsData.value,
                            unit: obs.unit || '',
                            system: 'http://unitsofmeasure.org'
                        }
                    }),
                    
                    ...(typeof obsData?.value === 'string' && {
                        valueString: obsData.value
                    }),
                    
                    ...(typeof obsData?.value === 'object' && obsData.value !== null && {
                        component: Object.entries(obsData.value).map(([key, val]) => ({
                            code: {
                                text: key,
                                coding: [{
                                    system: 'http://loinc.org',
                                    code: generateLoincCode(key),
                                    display: key
                                }]
                            },
                            valueQuantity: typeof val === 'number' ? {
                                value: val,
                                unit: obs.unit || ''
                            } : undefined,
                            valueString: typeof val === 'string' ? val : undefined
                        }))
                    }),
                    
                    // Reference range
                    ...(obsData?.referenceRange && {
                        referenceRange: [{
                            text: obsData.referenceRange
                        }]
                    }),
                    
                    // Interpretation
                    ...(obsData?.abnormalFlag && obsData.abnormalFlag !== 'NORMAL' && {
                        interpretation: [{
                            coding: [{
                                system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
                                code: obsData.abnormalFlag === 'HIGH' ? 'H' : 
                                      obsData.abnormalFlag === 'LOW' ? 'L' : 
                                      obsData.abnormalFlag === 'CRITICAL' ? 'HH' : 'N',
                                display: obsData.abnormalFlag
                            }]
                        }]
                    }),
                    
                    // Clinical notes
                    ...(obsData?.doctorNotes && {
                        note: [{
                            text: obsData.doctorNotes,
                            time: obs.createdAt
                        }]
                    })
                }
            };
        })
    };
};

const convertToCSV = (observations: any[]): string => {
    if (observations.length === 0) return '';
    
    const headers = [
        'ID', 'Code', 'Category', 'Subcategory', 'Value', 'Unit', 'Reference Range',
        'Status', 'Priority', 'Is Critical', 'Abnormal Flag', 'Recorded At',
        'Recorded By', 'Role', 'Patient Recorded', 'Notes', 'Doctor Notes',
        'Diagnosis', 'Advice'
    ];
    
    const csvRows = [headers.join(',')];
    
    observations.forEach(obs => {
        const row = [
            obs.id,
            `"${obs.code}"`,
            obs.category || '',
            obs.subcategory || '',
            typeof obs.value === 'object' ? `"${JSON.stringify(obs.value)}"` : obs.value,
            obs.unit || '',
            `"${obs.referenceRange || ''}"`,
            obs.status || '',
            obs.priority || '',
            obs.isCritical || false,
            obs.abnormalFlag || '',
            new Date(obs.recordedAt).toISOString(),
            `"${obs.recordedBy || ''}"`,
            obs.createdByRole || '',
            obs.isPatientRecorded || false,
            `"${obs.notes || ''}"`,
            `"${obs.doctorNotes || ''}"`,
            `"${obs.diagnosis || ''}"`,
            `"${obs.advice || ''}"`
        ];
        csvRows.push(row.join(','));
    });
    
    return csvRows.join('\n');
};

const generateLoincCode = (observationCode: string): string => {
    // This is a simplified mapping - in production, you'd use a proper LOINC database
    const loincMap: { [key: string]: string } = {
        'blood pressure': '85354-9',
        'heart rate': '8867-4',
        'temperature': '8310-5',
        'weight': '29463-7',
        'height': '8302-2',
        'glucose': '33747-0',
        'cholesterol': '2093-3'
    };
    
    const lowerCode = observationCode.toLowerCase();
    for (const [key, code] of Object.entries(loincMap)) {
        if (lowerCode.includes(key)) {
            return code;
        }
    }
    
    return '33999-4'; // Generic observation code
};

export default {
    createEnhancedObservation,
    getObservationsByCategory,
    getObservationTrends,
    getObservationAnalytics,
    addPrescriptionToObservation,
    updateObservationStatus,
    getCriticalObservations,
    getObservationAuditTrail,
    exportObservations
};