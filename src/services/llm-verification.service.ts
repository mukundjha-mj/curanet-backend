// Interface definitions
interface HealthInsight {
  type: 'info' | 'warning' | 'recommendation' | 'trend';
  priority: 'low' | 'medium' | 'high';
  title: string;
  message: string;
  confidence: number;
  category: string;
  recommendations?: string[];
  requiresDoctorReview: boolean;
}

// Enhanced LLM Response Verification System
export class LLMResponseVerifier {
  
  // 1. Medical Data Cross-Reference
  private static MEDICAL_KNOWLEDGE_BASE = {
    vitals: {
      bloodPressure: {
        normal: { systolic: [90, 120], diastolic: [60, 80] },
        elevated: { systolic: [120, 129], diastolic: [60, 80] },
        stage1: { systolic: [130, 139], diastolic: [80, 89] },
        stage2: { systolic: [140, 180], diastolic: [90, 120] },
        crisis: { systolic: ">180", diastolic: ">120" }
      },
      heartRate: {
        normal: [60, 100],
        bradycardia: "<60",
        tachycardia: ">100",
        dangerous: ">150"
      },
      temperature: {
        normal: [97.0, 99.5],
        lowGrade: [99.6, 100.3],
        fever: [100.4, 102.2],
        highFever: ">102.2"
      }
    },
    redFlags: [
      'chest pain', 'shortness of breath', 'severe headache',
      'loss of consciousness', 'severe bleeding', 'stroke symptoms'
    ]
  };

  // 2. Response Authenticity Checks
  static verifyResponse(response: any, originalData: any): {
    isValid: boolean;
    confidence: number;
    warnings: string[];
    verification: {
      structureValid: boolean;
      medicallyReasonable: boolean;
      dataConsistent: boolean;
      safetyChecked: boolean;
    };
  } {
    const warnings: string[] = [];
    let confidence = 1.0;
    
    const verification = {
      structureValid: this.checkResponseStructure(response, warnings),
      medicallyReasonable: this.checkMedicalReasonableness(response, warnings),
      dataConsistent: this.checkDataConsistency(response, originalData, warnings),
      safetyChecked: this.checkSafetyViolations(response, warnings)
    };

    // Calculate overall confidence
    const validChecks = Object.values(verification).filter(Boolean).length;
    confidence = validChecks / Object.keys(verification).length;

    // Reduce confidence for warnings
    confidence -= (warnings.length * 0.1);
    confidence = Math.max(0, Math.min(1, confidence));

    return {
      isValid: confidence >= 0.7 && verification.safetyChecked,
      confidence,
      warnings,
      verification
    };
  }

  // 3. Structure Validation
  private static checkResponseStructure(response: any, warnings: string[]): boolean {
    const requiredFields = ['insights', 'summary', 'dataQuality'];
    const missingFields = requiredFields.filter(field => !response[field]);
    
    if (missingFields.length > 0) {
      warnings.push(`Missing required fields: ${missingFields.join(', ')}`);
      return false;
    }

    // Check insights structure
    if (!Array.isArray(response.insights)) {
      warnings.push('Insights should be an array');
      return false;
    }

    // Validate each insight
    for (const insight of response.insights) {
      const insightRequired = ['type', 'priority', 'title', 'message', 'confidence'];
      const missingInsightFields = insightRequired.filter(field => !insight[field]);
      
      if (missingInsightFields.length > 0) {
        warnings.push(`Insight missing fields: ${missingInsightFields.join(', ')}`);
        return false;
      }

      // Check confidence is between 0 and 1
      if (insight.confidence < 0 || insight.confidence > 1) {
        warnings.push(`Invalid confidence value: ${insight.confidence}`);
        return false;
      }
    }

    return true;
  }

  // 4. Medical Reasonableness Check
  private static checkMedicalReasonableness(response: any, warnings: string[]): boolean {
    let reasonable = true;

    for (const insight of response.insights || []) {
      // Check for dangerous medical advice
      const dangerousTerms = ['diagnose', 'cure', 'treat', 'medicine', 'drug', 'surgery'];
      const hasDangerous = dangerousTerms.some(term => 
        insight.message.toLowerCase().includes(term)
      );

      if (hasDangerous) {
        warnings.push(`Potentially dangerous medical advice detected: ${insight.title}`);
        reasonable = false;
      }

      // Check confidence alignment with priority
      if (insight.priority === 'high' && insight.confidence < 0.8) {
        warnings.push(`High priority insight with low confidence: ${insight.title}`);
        reasonable = false;
      }

      // Check for unrealistic values or claims
      if (insight.message.includes('100%') || insight.message.includes('never') || 
          insight.message.includes('always') || insight.message.includes('cure')) {
        warnings.push(`Unrealistic medical claim detected: ${insight.title}`);
        reasonable = false;
      }
    }

    return reasonable;
  }

  // 5. Data Consistency Check
  private static checkDataConsistency(response: any, originalData: any, warnings: string[]): boolean {
    let consistent = true;

    // Check if insights match the provided data
    const hasVitals = originalData?.observations?.some((obs: any) => obs.code === 'vitals');
    const hasVitalInsights = response.insights?.some((insight: any) => 
      insight.category === 'vitals' || insight.message.toLowerCase().includes('blood pressure')
    );

    if (!hasVitals && hasVitalInsights) {
      warnings.push('AI generated vital insights without vital data');
      consistent = false;
    }

    // Check for contradictory insights
    const insights = response.insights || [];
    for (let i = 0; i < insights.length; i++) {
      for (let j = i + 1; j < insights.length; j++) {
        if (this.areInsightsContradictory(insights[i], insights[j])) {
          warnings.push(`Contradictory insights detected: ${insights[i].title} vs ${insights[j].title}`);
          consistent = false;
        }
      }
    }

    return consistent;
  }

  // 6. Safety Violations Check
  private static checkSafetyViolations(response: any, warnings: string[]): boolean {
    let safe = true;

    const emergencyTerms = ['emergency', 'call 911', 'hospital immediately', 'life-threatening'];
    const disclaimerRequired = ['This is not medical advice', 'Consult healthcare provider'];

    // Check for emergency advice without proper disclaimers
    for (const insight of response.insights || []) {
      const hasEmergency = emergencyTerms.some(term => 
        insight.message.toLowerCase().includes(term.toLowerCase())
      );
      
      const hasDisclaimer = disclaimerRequired.some(disclaimer => 
        insight.message.includes(disclaimer)
      );

      if (hasEmergency && !hasDisclaimer) {
        warnings.push(`Emergency advice without proper disclaimer: ${insight.title}`);
        safe = false;
      }
    }

    return safe;
  }

  // 7. Check for Contradictory Insights
  private static areInsightsContradictory(insight1: any, insight2: any): boolean {
    // Simple contradiction check - can be enhanced
    const positiveWords = ['good', 'excellent', 'healthy', 'normal'];
    const negativeWords = ['concerning', 'abnormal', 'elevated', 'low'];

    const insight1Positive = positiveWords.some(word => 
      insight1.message.toLowerCase().includes(word)
    );
    const insight1Negative = negativeWords.some(word => 
      insight1.message.toLowerCase().includes(word)
    );

    const insight2Positive = positiveWords.some(word => 
      insight2.message.toLowerCase().includes(word)
    );
    const insight2Negative = negativeWords.some(word => 
      insight2.message.toLowerCase().includes(word)
    );

    // Same category but opposite sentiments
    return insight1.category === insight2.category && 
           ((insight1Positive && insight2Negative) || (insight1Negative && insight2Positive));
  }

  // 8. Generate Verification Report
  static generateVerificationReport(verification: any): string {
    let report = "🔍 LLM Response Verification Report\\n\\n";
    
    report += `✅ Overall Validity: ${verification.isValid ? 'VALID' : 'INVALID'}\\n`;
    report += `🎯 Confidence Score: ${(verification.confidence * 100).toFixed(1)}%\\n\\n`;
    
    report += "📋 Checks Performed:\\n";
    report += `• Structure Valid: ${verification.verification.structureValid ? '✅' : '❌'}\\n`;
    report += `• Medically Reasonable: ${verification.verification.medicallyReasonable ? '✅' : '❌'}\\n`;
    report += `• Data Consistent: ${verification.verification.dataConsistent ? '✅' : '❌'}\\n`;
    report += `• Safety Checked: ${verification.verification.safetyChecked ? '✅' : '❌'}\\n`;

    if (verification.warnings.length > 0) {
      report += "\\n⚠️ Warnings:\\n";
      verification.warnings.forEach((warning: string, index: number) => {
        report += `${index + 1}. ${warning}\\n`;
      });
    }

    return report;
  }
}

// 9. Additional Security Measures
export class LLMSecurityEnforcer {
  
  // Rate limiting for AI requests
  private static requestCounts = new Map<string, { count: number; lastReset: number }>();
  
  static checkRateLimit(userId: string, maxRequests: number = 10, windowMs: number = 60000): boolean {
    const now = Date.now();
    const userRequests = this.requestCounts.get(userId);
    
    if (!userRequests || now - userRequests.lastReset > windowMs) {
      this.requestCounts.set(userId, { count: 1, lastReset: now });
      return true;
    }
    
    if (userRequests.count >= maxRequests) {
      return false;
    }
    
    userRequests.count++;
    return true;
  }

  // Input sanitization
  static sanitizeInput(data: any): any {
    // Remove potentially malicious content
    const sanitized = JSON.parse(JSON.stringify(data));
    
    // Recursive sanitization function
    const sanitize = (obj: any): any => {
      if (typeof obj === 'string') {
        return obj.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                 .replace(/javascript:/gi, '')
                 .replace(/on\w+=/gi, '');
      }
      
      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }
      
      if (obj && typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = sanitize(value);
        }
        return result;
      }
      
      return obj;
    };
    
    return sanitize(sanitized);
  }
}

export default { LLMResponseVerifier, LLMSecurityEnforcer };