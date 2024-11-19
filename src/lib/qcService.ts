import { 
  collection, 
  query, 
  where, 
  getDocs,
  doc,
  getDoc,
  QueryConstraint
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { QCData, QCAnalysis, QCStats } from '../types';

// Calculate statistics for an array of measurements
export const calculateStats = (measurements: number[] = []): QCStats => {
  const validMeasurements = measurements.filter(m => typeof m === 'number' && !isNaN(m));
  const n = validMeasurements.length;
  
  if (n === 0) {
    return {
      mean: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      measurements: []
    };
  }

  const mean = validMeasurements.reduce((a, b) => a + b, 0) / n;
  const variance = validMeasurements.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...validMeasurements);
  const max = Math.max(...validMeasurements);

  return {
    mean,
    stdDev,
    min,
    max,
    measurements: validMeasurements
  };
};

// Calculate process capability indices
export const calculateCapabilityIndices = (
  stats: { mean: number; stdDev: number },
  usl: number,
  lsl: number
) => {
  if (stats.stdDev === 0 || !usl || !lsl) return { cp: undefined, cpk: undefined };
  
  const cp = (usl - lsl) / (6 * stats.stdDev);
  const cpu = (usl - stats.mean) / (3 * stats.stdDev);
  const cpl = (stats.mean - lsl) / (3 * stats.stdDev);
  const cpk = Math.min(cpu, cpl);

  return { cp, cpk };
};

// Get QC analysis by SKU and optionally by batch
export const getQCAnalysisBySKU = async (
  sku: string,
  batchId?: string
): Promise<QCAnalysis> => {
  try {
    const measurementsRef = collection(db, 'measurements');
    const constraints: QueryConstraint[] = [where('sku', '==', sku)];
    
    if (batchId) {
      constraints.push(where('batchId', '==', batchId));
    }
    
    const q = query(measurementsRef, ...constraints);
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return {
        sku,
        totalMeasurements: 0,
        topCoilStats: calculateStats([]),
        bottomCoilStats: calculateStats([]),
        passRate: 0,
        batchCount: 0
      };
    }

    const measurements = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as QCData[];

    const batchIds = new Set(measurements.map(m => m.batchId));

    // Extract all height measurements
    const topCoilMeasurements = measurements
      .flatMap(m => (m.topCoilData || []).map(d => parseFloat(d?.height || '')))
      .filter(h => !isNaN(h));

    const bottomCoilMeasurements = measurements
      .flatMap(m => (m.bottomCoilData || []).map(d => parseFloat(d?.height || '')))
      .filter(h => !isNaN(h));

    // Calculate basic statistics
    const topStats = calculateStats(topCoilMeasurements);
    const bottomStats = calculateStats(bottomCoilMeasurements);

    // Calculate pass rate
    const passCount = measurements.filter(m => m.result === 'pass').length;
    const passRate = measurements.length > 0 ? passCount / measurements.length : 0;

    return {
      sku,
      totalMeasurements: measurements.length,
      topCoilStats: topStats,
      bottomCoilStats: bottomStats,
      passRate,
      batchCount: batchIds.size
    };
  } catch (error) {
    console.error('Error getting QC analysis:', error);
    throw error;
  }
};

// Get batches by SKU
export const getBatchesBySKU = async (sku: string): Promise<{ id: string; batchNumber: string }[]> => {
  try {
    const batchesRef = collection(db, 'batches');
    const q = query(batchesRef, where('sku', '==', sku));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      batchNumber: doc.data().batchNumber || ''
    }));
  } catch (error) {
    console.error('Error getting batches:', error);
    throw error;
  }
};