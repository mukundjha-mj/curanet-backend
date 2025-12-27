import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthedRequest extends Request {
    user?: {
        healthId: string;
        email: string | null;
        role: string;
        status: string;
        tokenId: string;
    };
}

// Doctor Analytics Controller
export const getDoctorOverview = async (req: AuthedRequest, res: Response) => {
    try {
        const { doctorId } = req.params;
        const { from, to } = req.query;
        const actor = req.user;

        if (!actor) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        // Only doctors can access doctor analytics, and only for themselves unless admin
        if (actor.role !== 'doctor' && actor.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied. Doctor or admin role required.' });
        }

        if (actor.role === 'doctor' && actor.healthId !== doctorId) {
            return res.status(403).json({ message: 'Access denied. Can only view your own analytics.' });
        }

        const fromDate = from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const toDate = to ? new Date(to as string) : new Date();

        // Get doctor's patient count (patients who have encounters with this doctor)
        const patientCount = await prisma.user.count({
            where: {
                role: 'patient',
                patientAppointments: {
                    some: {
                        doctorId: doctorId
                    }
                }
            }
        });

        // Get encounters in date range
        const encounters = await prisma.encounter.findMany({
            where: {
                providerId: doctorId,
                createdAt: {
                    gte: fromDate,
                    lte: toDate
                }
            }
        });

        // Get observations for this doctor's encounters
        const observations = await prisma.observation.findMany({
            where: {
                providerId: doctorId,
                createdAt: {
                    gte: fromDate,
                    lte: toDate
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Calculate critical observations (based on value patterns)
        const criticalObservations = observations.filter(obs => {
            const value = obs.value as any;
            const code = obs.code.toLowerCase();
            
            // Define critical thresholds
            if (code.includes('blood_pressure') && typeof value === 'number') {
                return value > 180 || value < 60; // Systolic > 180 or < 60
            }
            if (code.includes('heart_rate') && typeof value === 'number') {
                return value > 120 || value < 50;
            }
            if (code.includes('temperature') && typeof value === 'number') {
                return value > 102 || value < 95; // Fahrenheit
            }
            if (code.includes('glucose') && typeof value === 'number') {
                return value > 250 || value < 70;
            }
            return false;
        });

        // Get high-risk patients (patients with recent critical values)
        const criticalPatientIds = [...new Set(criticalObservations
            .filter(obs => new Date(obs.createdAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
            .map(obs => obs.patientId))];

        const highRiskPatients = await prisma.user.findMany({
            where: {
                healthId: {
                    in: criticalPatientIds
                }
            },
            select: {
                healthId: true,
                email: true,
                role: true
            }
        });

        // Calculate vital trends
        const vitalTrendsByCode = observations.reduce((acc: any, obs) => {
            const code = obs.code;
            if (!acc[code]) {
                acc[code] = { values: [], count: 0 };
            }
            
            const value = obs.value as any;
            if (typeof value === 'number') {
                acc[code].values.push(value);
            }
            acc[code].count++;
            
            return acc;
        }, {});

        const vitalTrends = Object.entries(vitalTrendsByCode).map(([code, data]: [string, any]) => ({
            type: code,
            averageValue: data.values.length > 0 ? 
                data.values.reduce((a: number, b: number) => a + b, 0) / data.values.length : 0,
            count: data.count
        }));

        // Daily encounter volume
        const dailyEncounterMap = encounters.reduce((acc: any, encounter) => {
            const date = encounter.createdAt.toISOString().split('T')[0];
            acc[date] = (acc[date] || 0) + 1;
            return acc;
        }, {});

        const dailyEncounters = Object.entries(dailyEncounterMap).map(([date, count]) => ({
            date,
            count
        })).sort((a, b) => b.date.localeCompare(a.date));

        // Patient verification queue (unverified self-reported observations)
        const unverifiedObservations = await prisma.observation.findMany({
            where: {
                source: 'PATIENT_SELF_REPORTED' as any,
                verificationStatus: 'PENDING',
                providerId: doctorId
            },
            orderBy: [
                { createdAt: 'desc' }
            ],
            take: 20
        });

        const analytics = {
            overview: {
                patientCount,
                encounterCount: encounters.length,
                criticalAlertCount: criticalObservations.length,
                pendingVerifications: unverifiedObservations.length
            },
            highRiskPatients: highRiskPatients.map(patient => ({
                healthId: patient.healthId,
                email: patient.email,
                criticalObservationsCount: criticalObservations.filter(obs => obs.patientId === patient.healthId).length
            })),
            vitalTrends,
            dailyEncounters,
            criticalObservations: criticalObservations.slice(0, 10).map(obs => ({
                id: obs.id,
                code: obs.code,
                value: obs.value,
                patientId: obs.patientId,
                createdAt: obs.createdAt,
                priority: 'HIGH'
            })),
            unverifiedObservations: unverifiedObservations.map(obs => ({
                id: obs.id,
                code: obs.code,
                value: obs.value,
                patientId: obs.patientId,
                createdAt: obs.createdAt,
                verificationStatus: obs.verificationStatus
            }))
        };

        res.json({
            success: true,
            data: analytics,
            dateRange: {
                from: fromDate,
                to: toDate
            }
        });

    } catch (error) {
        console.error('Error fetching doctor analytics:', error);
        res.status(500).json({
            message: 'Failed to fetch doctor analytics',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

// Admin Analytics Controller
export const getAdminOverview = async (req: AuthedRequest, res: Response) => {
    try {
        const { from, to } = req.query;
        const actor = req.user;

        if (!actor) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        if (actor.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied. Admin role required.' });
        }

        const fromDate = from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const toDate = to ? new Date(to as string) : new Date();

        // System overview metrics
        const totalUsers = await prisma.user.count();
        const activeUsers = await prisma.user.count({
            where: {
                updatedAt: {
                    gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
                }
            }
        });

        const patientCount = await prisma.user.count({
            where: { role: 'patient' }
        });

        const doctorCount = await prisma.user.count({
            where: { role: 'doctor' }
        });

        // Daily signups
        const recentUsers = await prisma.user.findMany({
            where: {
                createdAt: {
                    gte: fromDate,
                    lte: toDate
                }
            },
            select: {
                createdAt: true
            }
        });

        const dailySignupMap = recentUsers.reduce((acc: any, user) => {
            const date = user.createdAt.toISOString().split('T')[0];
            acc[date] = (acc[date] || 0) + 1;
            return acc;
        }, {});

        const dailySignups = Object.entries(dailySignupMap).map(([date, count]) => ({
            date,
            count
        })).sort((a, b) => b.date.localeCompare(a.date));

        // Consent metrics
        const consentMetrics = await prisma.consent.groupBy({
            by: ['status'],
            _count: {
                id: true
            },
            where: {
                createdAt: {
                    gte: fromDate,
                    lte: toDate
                }
            }
        });

        // All observations for critical analysis
        const allObservations = await prisma.observation.findMany({
            where: {
                createdAt: {
                    gte: fromDate,
                    lte: toDate
                }
            }
        });

        // Calculate critical alerts
        const criticalObservations = allObservations.filter(obs => {
            const value = obs.value as any;
            const code = obs.code.toLowerCase();
            
            if (code.includes('blood_pressure') && typeof value === 'number') {
                return value > 180 || value < 60;
            }
            if (code.includes('heart_rate') && typeof value === 'number') {
                return value > 120 || value < 50;
            }
            if (code.includes('temperature') && typeof value === 'number') {
                return value > 102 || value < 95;
            }
            if (code.includes('glucose') && typeof value === 'number') {
                return value > 250 || value < 70;
            }
            return false;
        });

        const dailyCriticalMap = criticalObservations.reduce((acc: any, obs) => {
            const date = obs.createdAt.toISOString().split('T')[0];
            acc[date] = (acc[date] || 0) + 1;
            return acc;
        }, {});

        const dailyCriticalAlerts = Object.entries(dailyCriticalMap).map(([date, count]) => ({
            date,
            count
        })).sort((a, b) => b.date.localeCompare(a.date));

        // Top observation types
        const observationTypeMap = allObservations.reduce((acc: any, obs) => {
            const code = obs.code;
            acc[code] = (acc[code] || 0) + 1;
            return acc;
        }, {});

        const topObservationTypes = Object.entries(observationTypeMap)
            .map(([type, count]) => ({ type, count }))
            .sort((a: any, b: any) => b.count - a.count)
            .slice(0, 10);

        // System health metrics
        const systemHealth = {
            totalEncounters: await prisma.encounter.count(),
            totalObservations: await prisma.observation.count(),
            totalAppointments: await prisma.appointment.count(),
            avgResponseTime: '150ms', // Would come from monitoring
            errorRate: '0.1%', // Would come from monitoring
            uptime: '99.9%' // Would come from monitoring
        };

        // Doctor workload
        const doctorWorkload = await prisma.encounter.groupBy({
            by: ['providerId'],
            _count: {
                id: true
            },
            where: {
                createdAt: {
                    gte: fromDate,
                    lte: toDate
                }
            },
            orderBy: {
                _count: {
                    id: 'desc'
                }
            },
            take: 10
        });

        // Get doctor emails for workload
        const doctorIds = doctorWorkload.map(d => d.providerId);
        const doctors = await prisma.user.findMany({
            where: {
                healthId: {
                    in: doctorIds
                }
            },
            select: {
                healthId: true,
                email: true
            }
        });

        const doctorWorkloadWithNames = doctorWorkload.map(workload => {
            const doctor = doctors.find(d => d.healthId === workload.providerId);
            return {
                doctorId: workload.providerId,
                doctorEmail: doctor?.email || 'Unknown',
                encounterCount: workload._count.id
            };
        });

        const analytics = {
            overview: {
                totalUsers,
                activeUsers,
                patientCount,
                doctorCount,
                totalEncounters: systemHealth.totalEncounters,
                totalObservations: systemHealth.totalObservations
            },
            dailySignups,
            consentMetrics: consentMetrics.map(metric => ({
                status: metric.status,
                count: metric._count.id
            })),
            dailyCriticalAlerts,
            topObservationTypes,
            doctorWorkload: doctorWorkloadWithNames,
            systemHealth
        };

        res.json({
            success: true,
            data: analytics,
            dateRange: {
                from: fromDate,
                to: toDate
            }
        });

    } catch (error) {
        console.error('Error fetching admin analytics:', error);
        res.status(500).json({
            message: 'Failed to fetch admin analytics',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

// Population Trend Analytics
export const getPopulationTrend = async (req: AuthedRequest, res: Response) => {
    try {
        const { metric, from, to } = req.query;
        const actor = req.user;

        if (!actor) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        if (actor.role !== 'admin' && actor.role !== 'doctor') {
            return res.status(403).json({ message: 'Access denied. Doctor or admin role required.' });
        }

        if (!metric) {
            return res.status(400).json({ message: 'Metric parameter is required' });
        }

        const fromDate = from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const toDate = to ? new Date(to as string) : new Date();

        const whereClause: any = {
            code: {
                contains: metric as string,
                mode: 'insensitive'
            },
            createdAt: {
                gte: fromDate,
                lte: toDate
            }
        };

        // If doctor, filter to their patients only
        if (actor.role === 'doctor') {
            whereClause.providerId = actor.healthId;
        }

        const observations = await prisma.observation.findMany({
            where: whereClause,
            select: {
                value: true,
                createdAt: true
            }
        });

        // Group by date and calculate statistics
        const trendMap = observations.reduce((acc: any, obs) => {
            const date = obs.createdAt.toISOString().split('T')[0];
            const value = obs.value as any;
            
            if (!acc[date]) {
                acc[date] = { values: [], count: 0 };
            }
            
            if (typeof value === 'number') {
                acc[date].values.push(value);
            }
            acc[date].count++;
            
            return acc;
        }, {});

        const trendData = Object.entries(trendMap).map(([date, data]: [string, any]) => ({
            date,
            avg_value: data.values.length > 0 ? 
                data.values.reduce((a: number, b: number) => a + b, 0) / data.values.length : null,
            min_value: data.values.length > 0 ? Math.min(...data.values) : null,
            max_value: data.values.length > 0 ? Math.max(...data.values) : null,
            count: data.count
        })).sort((a, b) => b.date.localeCompare(a.date));

        res.json({
            success: true,
            data: {
                metric,
                trend: trendData
            },
            dateRange: {
                from: fromDate,
                to: toDate
            }
        });

    } catch (error) {
        console.error('Error fetching population trend:', error);
        res.status(500).json({
            message: 'Failed to fetch population trend',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

// Export data as CSV
export const exportAnalytics = async (req: AuthedRequest, res: Response) => {
    try {
        const { type, from, to } = req.query;
        const actor = req.user;

        if (!actor) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        if (!type) {
            return res.status(400).json({ message: 'Export type is required' });
        }

        const fromDate = from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const toDate = to ? new Date(to as string) : new Date();

        let csvData: string = '';
        let filename: string = '';

        switch (type) {
            case 'critical_alerts':
                if (actor.role !== 'admin' && actor.role !== 'doctor') {
                    return res.status(403).json({ message: 'Access denied' });
                }

                const whereClause: any = {
                    createdAt: {
                        gte: fromDate,
                        lte: toDate
                    }
                };

                if (actor.role === 'doctor') {
                    whereClause.providerId = actor.healthId;
                }

                const observations = await prisma.observation.findMany({
                    where: whereClause,
                    orderBy: {
                        createdAt: 'desc'
                    }
                });

                // Filter for critical values
                const criticalAlerts = observations.filter(obs => {
                    const value = obs.value as any;
                    const code = obs.code.toLowerCase();
                    
                    if (code.includes('blood_pressure') && typeof value === 'number') {
                        return value > 180 || value < 60;
                    }
                    if (code.includes('heart_rate') && typeof value === 'number') {
                        return value > 120 || value < 50;
                    }
                    if (code.includes('temperature') && typeof value === 'number') {
                        return value > 102 || value < 95;
                    }
                    if (code.includes('glucose') && typeof value === 'number') {
                        return value > 250 || value < 70;
                    }
                    return false;
                });

                csvData = 'Date,Patient ID,Code,Value,Unit,Critical\n';
                csvData += criticalAlerts.map(alert => 
                    `${alert.createdAt.toISOString().split('T')[0]},${alert.patientId},${alert.code},${JSON.stringify(alert.value)},${alert.unit || ''},Yes`
                ).join('\n');
                
                filename = `critical_alerts_${fromDate.toISOString().split('T')[0]}_to_${toDate.toISOString().split('T')[0]}.csv`;
                break;

            case 'daily_encounters':
                if (actor.role !== 'admin' && actor.role !== 'doctor') {
                    return res.status(403).json({ message: 'Access denied' });
                }

                const encounterWhereClause: any = {
                    createdAt: {
                        gte: fromDate,
                        lte: toDate
                    }
                };

                if (actor.role === 'doctor') {
                    encounterWhereClause.providerId = actor.healthId;
                }

                const encounters = await prisma.encounter.findMany({
                    where: encounterWhereClause,
                    select: {
                        createdAt: true
                    }
                });

                const dailyEncounterMap = encounters.reduce((acc: any, encounter) => {
                    const date = encounter.createdAt.toISOString().split('T')[0];
                    acc[date] = (acc[date] || 0) + 1;
                    return acc;
                }, {});

                csvData = 'Date,Encounter Count\n';
                csvData += Object.entries(dailyEncounterMap)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .map(([date, count]) => `${date},${count}`)
                    .join('\n');
                
                filename = `daily_encounters_${fromDate.toISOString().split('T')[0]}_to_${toDate.toISOString().split('T')[0]}.csv`;
                break;

            default:
                return res.status(400).json({ message: 'Invalid export type' });
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvData);

    } catch (error) {
        console.error('Error exporting analytics:', error);
        res.status(500).json({
            message: 'Failed to export analytics',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export default {
    getDoctorOverview,
    getAdminOverview,
    getPopulationTrend,
    exportAnalytics
};