'use strict';

/**
 * Synthetic custody attendance record for PDF times/travel artifact generation.
 * No real client data — safe for commits and CI artifacts.
 */
function buildSyntheticAttendanceForPdfTimes() {
  return {
    forename: 'Synthetic',
    middleName: 'Demo',
    surname: 'Testclient',
    date: '2026-10-15',
    policeStationName: 'Synthetic Police Station',
    dsccRef: 'SYN-0001',
    offenceSummary: 'Theft from shop (synthetic demo offence)',
    feeEarnerName: 'Demo Rep',
    firmName: 'Synthetic Firm LLP',
    weekendBankHoliday: 'No',
    feeEarnerCertification: 'Finalised',
    timeSetOff: '08:15',
    timeArrival: '09:30',
    timeDeparture: '12:45',
    timeOfficeHome: '13:30',
    waitingTimeStart: '09:30',
    waitingTimeEnd: '10:00',
    travelSocial: 45,
    travelUnsocial: 75,
    waitingSocial: 30,
    waitingUnsocial: 0,
    adviceSocial: 165,
    adviceUnsocial: 0,
    totalMinutes: 315,
    milesClaimable: '42.5',
    parkingCost: '6.50',
    disbursements: [
      { description: 'Congestion charge (synthetic)', amount: '15.00', vatTreatment: 'No VAT' },
    ],
    interviews: [
      {
        startTime: '11:00',
        endTime: '12:15',
        present: 'Rep, client, OIC',
        cautioned: 'Yes',
        notes: 'Synthetic interview notes for PDF demo only.',
      },
    ],
    stationVisits: [
      {
        label: '',
        timeSetOff: '08:15',
        timeArrival: '09:30',
        timeDeparture: '12:45',
        timeOfficeHome: '13:30',
        waitingTimeStart: '09:30',
        waitingTimeEnd: '10:00',
        waitingTimeNotes: '',
        milesClaimable: '42.5',
        parkingCost: '6.50',
        notes: '',
        multiClient: '',
        clientStartTime: '',
        clientEndTime: '',
      },
    ],
    outcomeDecision: 'Released NFA',
  };
}

module.exports = { buildSyntheticAttendanceForPdfTimes };
