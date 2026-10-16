import { Aircraft } from '@/types/flight';

export const AIRCRAFT_FLEET: Aircraft[] = [
  {
    id: 'b787-9',
    name: 'Boeing 787-9 Dreamliner',
    manufacturer: 'Boeing',
    model: '787-9',
    type: 'widebody',
    cruiseSpeedKmh: 903, // Mach 0.85
    cruiseSpeedKnots: 488,
    maxRangeKm: 14140, // 7,635 NM
    cruiseAltitudeFt: 39000, // FL390
    climbRateFtMin: 2500,
    descentRateFtMin: 1800,
    takeoffSpeedKnots: 155,
    landingSpeedKnots: 140,
    passengerCapacity: 296,
    wingspanMeters: 60.1,
    description:
      'Advanced long-haul twin-engine jet made of carbon-fiber composites with high cruise efficiency and passenger comfort.',
  },
  {
    id: 'a350-900',
    name: 'Airbus A350-900 XWB',
    manufacturer: 'Airbus',
    model: 'A350-900',
    type: 'widebody',
    cruiseSpeedKmh: 903, // Mach 0.85
    cruiseSpeedKnots: 488,
    maxRangeKm: 15370, // 8,300 NM
    cruiseAltitudeFt: 41000, // FL410
    climbRateFtMin: 2600,
    descentRateFtMin: 1900,
    takeoffSpeedKnots: 158,
    landingSpeedKnots: 138,
    passengerCapacity: 315,
    wingspanMeters: 64.75,
    description:
      'Ultra-long-range wide-body airliner powered by Rolls-Royce Trent XWB engines, offering exceptional quietness and range.',
  },
  {
    id: 'b777-300er',
    name: 'Boeing 777-300ER',
    manufacturer: 'Boeing',
    model: '777-300ER',
    type: 'widebody',
    cruiseSpeedKmh: 905, // Mach 0.84
    cruiseSpeedKnots: 489,
    maxRangeKm: 13650,
    cruiseAltitudeFt: 36000,
    climbRateFtMin: 2400,
    descentRateFtMin: 1800,
    takeoffSpeedKnots: 165,
    landingSpeedKnots: 145,
    passengerCapacity: 396,
    wingspanMeters: 64.8,
    description:
      'The world’s most successful twin-engine long-haul aircraft, equipped with the massive GE90-115B turbofans.',
  },
  {
    id: 'b737-800',
    name: 'Boeing 737-800 NextGen',
    manufacturer: 'Boeing',
    model: '737-800',
    type: 'narrowbody',
    cruiseSpeedKmh: 838, // Mach 0.785
    cruiseSpeedKnots: 453,
    maxRangeKm: 5436, // 2,935 NM
    cruiseAltitudeFt: 35000, // FL350
    climbRateFtMin: 2200,
    descentRateFtMin: 1500,
    takeoffSpeedKnots: 145,
    landingSpeedKnots: 135,
    passengerCapacity: 175,
    wingspanMeters: 35.8,
    description:
      'The workhorse of global aviation, ideal for short-to-medium haul domestic and cross-border commercial routes.',
  },
  {
    id: 'a320neo',
    name: 'Airbus A320neo',
    manufacturer: 'Airbus',
    model: 'A320neo',
    type: 'narrowbody',
    cruiseSpeedKmh: 828, // Mach 0.78
    cruiseSpeedKnots: 447,
    maxRangeKm: 6300, // 3,400 NM
    cruiseAltitudeFt: 37000,
    climbRateFtMin: 2300,
    descentRateFtMin: 1600,
    takeoffSpeedKnots: 142,
    landingSpeedKnots: 132,
    passengerCapacity: 180,
    wingspanMeters: 35.8,
    description:
      'Modern single-aisle aircraft featuring Sharklets and high-bypass LEAP-1A / GTF geared turbofan engines.',
  },
  {
    id: 'concorde',
    name: 'Aérospatiale / BAC Concorde',
    manufacturer: 'Aérospatiale / BAC',
    model: 'Concorde SST',
    type: 'supersonic',
    cruiseSpeedKmh: 2158, // Mach 2.04
    cruiseSpeedKnots: 1165,
    maxRangeKm: 7222, // 3,900 NM
    cruiseAltitudeFt: 60000, // FL600
    climbRateFtMin: 3500,
    descentRateFtMin: 2500,
    takeoffSpeedKnots: 210,
    landingSpeedKnots: 165,
    passengerCapacity: 100,
    wingspanMeters: 25.6,
    description:
      'Legendary supersonic turbojet passenger airliner capable of transatlantic crossings in under 3.5 hours at Mach 2.04.',
  },
  {
    id: 'c172',
    name: 'Cessna 172 Skyhawk',
    manufacturer: 'Cessna',
    model: '172S',
    type: 'general',
    cruiseSpeedKmh: 226, // 122 kts
    cruiseSpeedKnots: 122,
    maxRangeKm: 1185, // 640 NM
    cruiseAltitudeFt: 8500,
    climbRateFtMin: 730,
    descentRateFtMin: 600,
    takeoffSpeedKnots: 55,
    landingSpeedKnots: 60,
    passengerCapacity: 4,
    wingspanMeters: 11.0,
    description:
      'The most popular single-engine general aviation aircraft in history, for scenic flights and pilot training.',
  },
];

export function getAircraftById(id: string): Aircraft | undefined {
  return AIRCRAFT_FLEET.find((p) => p.id === id);
}

export function canAircraftCoverDistance(aircraft: Aircraft, distanceKm: number): boolean {
  return distanceKm <= aircraft.maxRangeKm;
}

