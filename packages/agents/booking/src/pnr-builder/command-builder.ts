/**
 * PNR Command Builder — GDS-specific command generation.
 *
 * Name-field cryptic syntax (adult / child / infant) is documented in
 * `docs/knowledge-base/gds-pnr-name-commands.md`. Only forms verified from
 * public Amadeus Service Hub, Travelport Formats, and Delta agency Sabre
 * samples are emitted. Unverified hosts/forms stay as DOMAIN_QUESTION —
 * do not map "probably like Amadeus".
 *
 * TRAVELPORT dialect here follows Apollo colon (`N:`) to match existing
 * adult/contact/ticketing emissions (see DQ-N8 in the KB).
 */

import type {
  GdsSystem,
  PnrBuilderInput,
  PnrBuilderOutput,
  PnrCommand,
  PnrPassenger,
  PnrSegment,
  PnrContact,
  PnrTicketing,
  SsrElement,
  OsiElement,
} from './types.js';

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function formatDateGds(isoDate: string): string {
  const d = new Date(isoDate);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = MONTHS[d.getUTCMonth()]!;
  return `${day}${mon}`;
}

function formatDateDocs(isoDate: string): string {
  const d = new Date(isoDate);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = MONTHS[d.getUTCMonth()]!;
  const year = String(d.getUTCFullYear());
  return `${day}${mon}${year}`;
}

/** DDMMMYY — Amadeus CHD/INF, Sabre 3INFT, Travelport infant name remark. */
function formatDateDobYy(isoDate: string): string {
  const d = new Date(isoDate);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = MONTHS[d.getUTCMonth()]!;
  const year = String(d.getUTCFullYear()).slice(-2);
  // TODO: DOMAIN_QUESTION: DQ-N4 — YY century window across hosts
  return `${day}${mon}${year}`;
}

/**
 * Whole years between DOB and a reference date (UTC date parts).
 * TODO: DOMAIN_QUESTION: DQ-N7 — Travelport P-Cxx age as-of booking vs first departure.
 */
function ageYearsAt(isoDob: string, isoOn: string): number {
  const dob = new Date(isoDob);
  const on = new Date(isoOn);
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = on.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/** Sabre seated name number (n.1) for a passenger index, excluding lap infants. */
function sabreSeatedNameNumber(passengers: PnrPassenger[], passengerIndex: number): string {
  let n = 0;
  for (let i = 0; i <= passengerIndex && i < passengers.length; i++) {
    if (passengers[i]!.passenger_type !== 'INF') {
      n += 1;
    }
  }
  return `${n}.1`;
}

function amadeusInfantSuffix(adult: PnrPassenger, infant: PnrPassenger): string | undefined {
  const infFirst = infant.first_name.toUpperCase();
  const infLast = infant.last_name.toUpperCase();
  const adultLast = adult.last_name.toUpperCase();
  if (!infant.date_of_birth) {
    // TODO: DOMAIN_QUESTION: Amadeus INF without DOB — Service Hub examples always include DDMMMYY
    return undefined;
  }
  const dob = formatDateDobYy(infant.date_of_birth);
  if (infLast === adultLast) {
    return `(INF/${infFirst}/${dob})`;
  }
  return `(INF${infLast}/${infFirst}/${dob})`;
}

// ---------------------------------------------------------------------------
// Name commands
// ---------------------------------------------------------------------------

function buildNameCommands(
  gds: GdsSystem,
  passengers: PnrPassenger[],
  isGroup: boolean,
  groupName?: string,
  referenceDateIso?: string,
): PnrCommand[] {
  const commands: PnrCommand[] = [];

  if (isGroup && groupName) {
    switch (gds) {
      case 'AMADEUS':
        // Amadeus group: NM10GROUPNAME
        commands.push({
          command: `NM${passengers.length}${groupName.toUpperCase()}`,
          description: `Group name for ${passengers.length} passengers`,
          element_type: 'GROUP',
        });
        break;
      case 'SABRE':
        // Sabre group: 0GROUP NAME§10
        commands.push({
          command: `0${groupName.toUpperCase()}§${passengers.length}`,
          description: `Group name for ${passengers.length} passengers`,
          element_type: 'GROUP',
        });
        break;
      case 'TRAVELPORT':
        // Travelport group: N:10/GROUPNAME
        commands.push({
          command: `N:${passengers.length}/${groupName.toUpperCase()}`,
          description: `Group name for ${passengers.length} passengers`,
          element_type: 'GROUP',
        });
        break;
    }
  }

  // Seated names first (ADT + CHD). Amadeus lap INF is attached to the adult name.
  for (let i = 0; i < passengers.length; i++) {
    const pax = passengers[i]!;
    if (pax.passenger_type === 'INF') continue;

    const surname = pax.last_name.toUpperCase();
    const firstname = pax.first_name.toUpperCase();
    const title = pax.title ? ` ${pax.title.toUpperCase()}` : '';
    const linkedInfants = passengers.filter(
      (p) => p.passenger_type === 'INF' && p.infant_accompanying_adult === i,
    );

    switch (gds) {
      case 'AMADEUS': {
        let command = `NM1${surname}/${firstname}${title}`;
        if (pax.passenger_type === 'CHD') {
          if (pax.date_of_birth) {
            // Amadeus Service Hub: NM1SURNAME/FIRST(CHD/DDMMMYY)
            command = `NM1${surname}/${firstname}(CHD/${formatDateDobYy(pax.date_of_birth)})`;
          } else {
            // TODO: DOMAIN_QUESTION: Amadeus CHD without DOB — Service Hub examples always include DDMMMYY
            command = `NM1${surname}/${firstname}${title}`;
          }
        } else if (linkedInfants.length > 0) {
          // Service Hub: infant is on the adult name element, not a separate NM1
          const suffixes = linkedInfants
            .map((inf) => amadeusInfantSuffix(pax, inf))
            .filter((s): s is string => s !== undefined);
          if (suffixes.length > 0) {
            command = `NM1${surname}/${firstname}${title}${suffixes.join('')}`;
          } else {
            // TODO: DOMAIN_QUESTION: Amadeus INF linked but missing DOB — cannot emit verified (INF/…) form
            command = `NM1${surname}/${firstname}${title}`;
          }
        }
        commands.push({
          command,
          description:
            linkedInfants.length > 0
              ? `Name: ${surname}/${firstname} with infant(s)`
              : `Name: ${surname}/${firstname}`,
          element_type: 'NAME',
        });
        break;
      }
      case 'SABRE': {
        // TODO: DOMAIN_QUESTION: DQ-N1 — Sabre child age/PTC in name field not cited in public Format Finder
        // Adult-style name skeleton is verified (Travelport Formats Sabre column / Transavia Sabre PDF).
        commands.push({
          command: `-${surname}/${firstname}${title}`,
          description: `Name: ${surname}/${firstname}`,
          element_type: 'NAME',
        });
        break;
      }
      case 'TRAVELPORT': {
        // Apollo colon dialect (DQ-N8). Travelport+ uses N. / Worldspan uses -…*INF for infants.
        if (pax.passenger_type === 'CHD' && pax.date_of_birth && referenceDateIso) {
          const age = ageYearsAt(pax.date_of_birth, referenceDateIso);
          const ageCode = String(Math.max(0, Math.min(99, age))).padStart(2, '0');
          // Apollo: N:RYAN/TIM*P-C08 (Formats 1VBFFields). Leading 1 kept for parity with ADT emission.
          commands.push({
            command: `N:1${surname}/${firstname}*P-C${ageCode}`,
            description: `Child name: ${surname}/${firstname}`,
            element_type: 'NAME',
          });
        } else {
          if (pax.passenger_type === 'CHD' && !pax.date_of_birth) {
            // TODO: DOMAIN_QUESTION: Travelport/Apollo CHD without DOB — cannot build *P-Cxx
          }
          commands.push({
            command: `N:1${surname}/${firstname}${title}`,
            description: `Name: ${surname}/${firstname}`,
            element_type: 'NAME',
          });
        }
        break;
      }
    }
  }

  // Lap infant name fields (Sabre + Travelport). Amadeus INF is on the adult element above.
  for (const inf of passengers) {
    if (inf.passenger_type !== 'INF') continue;

    const surname = inf.last_name.toUpperCase();
    const firstname = inf.first_name.toUpperCase();
    const adultIdx = inf.infant_accompanying_adult ?? 0;
    const adultNameNum = sabreSeatedNameNumber(passengers, adultIdx);

    switch (gds) {
      case 'AMADEUS':
        // Already attached to adult NM1 when DOB present.
        break;
      case 'SABRE': {
        // Delta agency + Travelport Formats Sabre column: -I/SURNAME/FIRSTNAME
        // Do NOT emit Worldspan -SURNAME/FIRST*INF as Sabre.
        commands.push({
          command: `-I/${surname}/${firstname}`,
          description: `Infant: ${surname}/${firstname} with adult ${adultNameNum}`,
          element_type: 'NAME',
        });
        if (inf.date_of_birth) {
          // Delta: 3INFT/SURNAME/FIRST/DDMMMYY-1.1
          commands.push({
            command: `3INFT/${surname}/${firstname}/${formatDateDobYy(inf.date_of_birth)}-${adultNameNum}`,
            description: `SSR INFT for ${surname}/${firstname} linked to ${adultNameNum}`,
            element_type: 'SSR',
          });
        } else {
          // TODO: DOMAIN_QUESTION: Sabre 3INFT requires DOB — name field emitted without SSR when DOB absent
        }
        break;
      }
      case 'TRAVELPORT': {
        if (inf.date_of_birth) {
          // Apollo Formats: N:I/LEE/ANN*17JUL22/P-INF01
          commands.push({
            command: `N:I/${surname}/${firstname}*${formatDateDobYy(inf.date_of_birth)}/P-INF01`,
            description: `Infant: ${surname}/${firstname} with adult ${adultNameNum}`,
            element_type: 'NAME',
          });
        } else {
          // TODO: DOMAIN_QUESTION: Apollo/Travelport+ infant name requires *DDMMMYY (and Apollo /P-INF01)
          // Emit I/ prefix only — do not invent a DOB or Worldspan *INF.
          commands.push({
            command: `N:I/${surname}/${firstname}`,
            description: `Infant: ${surname}/${firstname} with adult ${adultNameNum} (DOB missing — incomplete)`,
            element_type: 'NAME',
          });
        }
        break;
      }
    }
  }

  return commands;
}

// ---------------------------------------------------------------------------
// Segment commands
// ---------------------------------------------------------------------------

function buildSegmentCommands(gds: GdsSystem, segments: PnrSegment[]): PnrCommand[] {
  return segments.map((seg) => {
    const date = formatDateGds(seg.departure_date);
    const carrier = seg.carrier.toUpperCase();
    const flightNum = seg.flight_number;
    const cls = seg.booking_class.toUpperCase();
    const origin = seg.origin.toUpperCase();
    const dest = seg.destination.toUpperCase();
    const qty = seg.quantity;
    const status = seg.status;

    let command: string;
    switch (gds) {
      case 'AMADEUS':
        // SS2 BA115 Y 15MAR LHRJFK SS2
        command = `SS${qty} ${carrier}${flightNum} ${cls} ${date} ${origin}${dest} ${status}${qty}`;
        break;
      case 'SABRE':
        // 0BA115Y15MARLHRJFKSS2
        command = `0${carrier}${flightNum}${cls}${date}${origin}${dest}${status}${qty}`;
        break;
      case 'TRAVELPORT':
        // 0BA115Y15MAR-LHRJFK/SS2
        command = `0${carrier}${flightNum}${cls}${date}-${origin}${dest}/${status}${qty}`;
        break;
    }

    return {
      command,
      description: `Segment: ${carrier}${flightNum} ${cls} ${date} ${origin}-${dest}`,
      element_type: 'SEGMENT' as const,
    };
  });
}

// ---------------------------------------------------------------------------
// Contact commands
// ---------------------------------------------------------------------------

function buildContactCommands(gds: GdsSystem, contacts: PnrContact[]): PnrCommand[] {
  const commands: PnrCommand[] = [];

  for (const contact of contacts) {
    const phone = contact.phone;
    const typeLabel = contact.type === 'AGENCY' ? 'A' : contact.type === 'PASSENGER' ? 'P' : 'E';

    switch (gds) {
      case 'AMADEUS':
        // AP +1-212-555-1234
        commands.push({
          command: `AP ${phone}`,
          description: `Phone (${contact.type}): ${phone}`,
          element_type: 'CONTACT',
        });
        break;
      case 'SABRE':
        // 9+1-212-555-1234-A
        commands.push({
          command: `9${phone}-${typeLabel}`,
          description: `Phone (${contact.type}): ${phone}`,
          element_type: 'CONTACT',
        });
        break;
      case 'TRAVELPORT':
        // P:SFOAS/+1-212-555-1234
        commands.push({
          command: `P:SFO${typeLabel}S/${phone}`,
          description: `Phone (${contact.type}): ${phone}`,
          element_type: 'CONTACT',
        });
        break;
    }

    // Email (CTCE SSR in most GDS)
    if (contact.email) {
      const emailEncoded = contact.email.replace('@', '//');
      switch (gds) {
        case 'AMADEUS':
          commands.push({
            command: `SR CTCE ${emailEncoded}-1.1`,
            description: `Email: ${contact.email}`,
            element_type: 'CONTACT',
          });
          break;
        case 'SABRE':
          commands.push({
            command: `3CTCE/${emailEncoded}`,
            description: `Email: ${contact.email}`,
            element_type: 'CONTACT',
          });
          break;
        case 'TRAVELPORT':
          commands.push({
            command: `SI.P1/CTCE/${emailEncoded}`,
            description: `Email: ${contact.email}`,
            element_type: 'CONTACT',
          });
          break;
      }
    }
  }

  return commands;
}

// ---------------------------------------------------------------------------
// Ticketing commands
// ---------------------------------------------------------------------------

function buildTicketingCommand(gds: GdsSystem, ticketing: PnrTicketing): PnrCommand {
  const date = formatDateGds(ticketing.time_limit);

  let command: string;
  switch (gds) {
    case 'AMADEUS':
      // TKTL15MAR
      command = `TKTL${date}`;
      break;
    case 'SABRE':
      // 7TAW15MAR
      command = `7TAW${date}`;
      break;
    case 'TRAVELPORT':
      // T:TAU/15MAR
      command = `T:TAU/${date}`;
      break;
  }

  return {
    command,
    description: `Ticketing time limit: ${date}`,
    element_type: 'TICKETING',
  };
}

// ---------------------------------------------------------------------------
// Received-from command
// ---------------------------------------------------------------------------

function buildReceivedFromCommand(gds: GdsSystem, receivedFrom: string): PnrCommand {
  let command: string;
  switch (gds) {
    case 'AMADEUS':
      // RF AGENT NAME
      command = `RF ${receivedFrom.toUpperCase()}`;
      break;
    case 'SABRE':
      // 6AGENT NAME
      command = `6${receivedFrom.toUpperCase()}`;
      break;
    case 'TRAVELPORT':
      // R:AGENT NAME
      command = `R:${receivedFrom.toUpperCase()}`;
      break;
  }

  return {
    command,
    description: `Received from: ${receivedFrom}`,
    element_type: 'RECEIVED_FROM',
  };
}

// ---------------------------------------------------------------------------
// SSR commands
// ---------------------------------------------------------------------------

function buildSsrCommands(gds: GdsSystem, ssrs: SsrElement[]): PnrCommand[] {
  return ssrs.map((ssr) => {
    const carrier = ssr.carrier.toUpperCase();
    const code = ssr.code;
    const paxNum = ssr.passenger_index;
    const text = ssr.text;
    const segRef = ssr.segment_index ? `/S${ssr.segment_index}` : '';

    let command: string;
    switch (gds) {
      case 'AMADEUS':
        // SR WCHR-BA/P1/S1
        command = `SR ${code} ${carrier !== 'YY' ? `-${carrier}` : ''}${segRef}/P${paxNum}${text ? `/${text}` : ''}`;
        break;
      case 'SABRE':
        // 3${CODE}${CARRIER}${SEGNUM}/TEXT-1.1
        command = `3${code}${carrier}${ssr.segment_index ?? ''}/${text}-${paxNum}.1`;
        break;
      case 'TRAVELPORT':
        // SI.P1/S1/${CODE}/${CARRIER}/${TEXT}
        command = `SI.P${paxNum}${segRef}/${code}/${carrier}/${text}`;
        break;
    }

    return {
      command,
      description: `SSR ${code} for P${paxNum}: ${text}`,
      element_type: 'SSR' as const,
    };
  });
}

// ---------------------------------------------------------------------------
// OSI commands
// ---------------------------------------------------------------------------

function buildOsiCommands(gds: GdsSystem, osis: OsiElement[]): PnrCommand[] {
  return osis.map((osi) => {
    const carrier = osi.carrier.toUpperCase();
    const text = osi.text.toUpperCase();

    let command: string;
    switch (gds) {
      case 'AMADEUS':
        command = `OS ${carrier} ${text}`;
        break;
      case 'SABRE':
        command = `3OSI${carrier}/${text}`;
        break;
      case 'TRAVELPORT':
        command = `SI.${carrier}/${text}`;
        break;
    }

    return {
      command,
      description: `OSI ${carrier}: ${text}`,
      element_type: 'OSI' as const,
    };
  });
}

// ---------------------------------------------------------------------------
// DOCS SSR (APIS) commands
// ---------------------------------------------------------------------------

function buildDocsCommands(gds: GdsSystem, passengers: PnrPassenger[]): PnrCommand[] {
  const commands: PnrCommand[] = [];

  for (let i = 0; i < passengers.length; i++) {
    const pax = passengers[i]!;
    if (!pax.passport_number || !pax.date_of_birth) continue;

    const paxNum = i + 1;
    const dob = formatDateDocs(pax.date_of_birth);
    const expiry = pax.passport_expiry ? formatDateDocs(pax.passport_expiry) : '';
    const gender = pax.gender ?? 'M';
    const nationality = pax.nationality ?? '';
    const ppCountry = pax.passport_country ?? nationality;
    const surname = pax.last_name.toUpperCase();
    const firstname = pax.first_name.toUpperCase();

    let command: string;
    switch (gds) {
      case 'AMADEUS':
        // SR DOCS YY HK1/P/GB/P12345678/GB/12JAN1985/M/15JAN2030/SMITH/JOHN-P1
        command = `SR DOCS YY HK1/P/${ppCountry}/${pax.passport_number}/${nationality}/${dob}/${gender}/${expiry}/${surname}/${firstname}-P${paxNum}`;
        break;
      case 'SABRE':
        // 3DOCS/DB/12JAN1985/M/SMITH/JOHN/P/GB/P12345678/GB/15JAN2030-1.1
        command = `3DOCS/DB/${dob}/${gender}/${surname}/${firstname}/P/${ppCountry}/${pax.passport_number}/${nationality}/${expiry}-${paxNum}.1`;
        break;
      case 'TRAVELPORT':
        // SI.P1/SSRDOCSYYHK1/P/GB/P12345678/GB/12JAN1985/M/15JAN2030/SMITH/JOHN
        command = `SI.P${paxNum}/SSRDOCSYYHK1/P/${ppCountry}/${pax.passport_number}/${nationality}/${dob}/${gender}/${expiry}/${surname}/${firstname}`;
        break;
    }

    commands.push({
      command,
      description: `DOCS/APIS for P${paxNum}: ${surname}/${firstname}`,
      element_type: 'SSR',
    });
  }

  return commands;
}

// ---------------------------------------------------------------------------
// End transaction command
// ---------------------------------------------------------------------------

function buildEndTransactCommand(gds: GdsSystem): PnrCommand {
  let command: string;
  switch (gds) {
    case 'AMADEUS':
      command = 'ET';
      break;
    case 'SABRE':
      command = 'E';
      break;
    case 'TRAVELPORT':
      command = 'ER';
      break;
  }

  return {
    command,
    description: 'End transaction and save PNR',
    element_type: 'END_TRANSACT',
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildPnrCommands(input: PnrBuilderInput): PnrBuilderOutput {
  const commands: PnrCommand[] = [];
  const isGroup = input.is_group ?? false;
  const infants = input.passengers.filter((p) => p.passenger_type === 'INF');
  // Used for Travelport *P-Cxx age (DQ-N7: first segment departure as provisional reference).
  const referenceDateIso = input.segments[0]?.departure_date;

  // 1. Names (or group header + names) + Sabre INFT SSR when DOB present
  commands.push(
    ...buildNameCommands(
      input.gds,
      input.passengers,
      isGroup,
      input.group_name,
      referenceDateIso,
    ),
  );

  // 2. Air segments
  commands.push(...buildSegmentCommands(input.gds, input.segments));

  // 3. Contact elements
  commands.push(...buildContactCommands(input.gds, input.contacts));

  // 4. Ticketing arrangement
  commands.push(buildTicketingCommand(input.gds, input.ticketing));

  // 5. Received from
  commands.push(buildReceivedFromCommand(input.gds, input.received_from));

  // 6. SSR elements
  if (input.ssrs && input.ssrs.length > 0) {
    commands.push(...buildSsrCommands(input.gds, input.ssrs));
  }

  // 7. DOCS/APIS for passengers with passport data
  commands.push(...buildDocsCommands(input.gds, input.passengers));

  // 8. OSI elements
  if (input.osis && input.osis.length > 0) {
    commands.push(...buildOsiCommands(input.gds, input.osis));
  }

  // 9. End transaction
  commands.push(buildEndTransactCommand(input.gds));

  return {
    gds: input.gds,
    commands,
    passenger_count: input.passengers.length,
    segment_count: input.segments.length,
    is_group: isGroup,
    infant_count: infants.length,
  };
}
