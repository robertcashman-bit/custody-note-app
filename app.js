/* ─── STATE ─── */
var views = { home: 'view-home', list: 'view-list', firms: 'view-firms', new: 'view-form', settings: 'view-settings', quickcapture: 'view-quickcapture', reports: 'view-reports', help: 'view-help' };
var currentAttendanceId = null;
var stations = [];
var firms = [];
var firmsPage = 1;
var FIRMS_PER_PAGE = 50;
var refData = {};
var formData = {};
var currentSectionIdx = 0;
var currentStandaloneSectionId = null;
var currentRecordStatus = null;
var currentRecordArchived = false;
var autoSaveTimer = null;
var _draftSaveInFlight = false;
var _draftSaveQueued = false;
var recentStationIds = [];
var magistratesCourts = [];
var paceTimer = null;
var listPage = 1;
var LIST_PER_PAGE = 50;

/* ─── UK BANK HOLIDAYS 2025-2027 (England & Wales) ─── */
var UK_BANK_HOLIDAYS = [
    '2025-01-01','2025-04-18','2025-04-21','2025-05-05','2025-05-26','2025-08-25','2025-12-25','2025-12-26',
    '2026-01-01','2026-04-03','2026-04-06','2026-05-04','2026-05-25','2026-08-31','2026-12-25','2026-12-28',
    '2027-01-01','2027-03-26','2027-03-29','2027-05-03','2027-05-31','2027-08-30','2027-12-27','2027-12-28',
  ];

  /* ─── UK CRIMINAL OFFENCES (grouped, CPS-based) – SO/EW/IO = mode of trial; matterType = LAA matter type code (1–21) ─── */
var OFFENCES_BY_GROUP = [
    { group: 'Homicide and related', defaultMatterType: '1', offences: [
      { name: 'Murder', statute: 'Common law', mode: 'IO' },
      { name: 'Manslaughter', statute: 'Common law', mode: 'IO' },
      { name: 'Infanticide', statute: 's.1 Infanticide Act 1938', mode: 'IO' },
      { name: 'Corporate manslaughter', statute: 's.1 Corporate Manslaughter and Corporate Homicide Act 2007', mode: 'IO' },
      { name: 'Causing or allowing death of child or vulnerable adult', statute: 's.5 Domestic Violence, Crime and Victims Act 2004', mode: 'IO' },
      { name: 'Causing or allowing serious physical harm to child or vulnerable adult', statute: 's.5 Domestic Violence, Crime and Victims Act 2004', mode: 'EW' },
      { name: 'Attempted murder', statute: 's.1 Criminal Attempts Act 1981', mode: 'IO' },
      { name: 'Conspiracy to murder', statute: 's.1 Criminal Law Act 1977', mode: 'IO' },
      { name: 'Soliciting to murder', statute: 's.4 Offences Against the Person Act 1861', mode: 'IO' },
      { name: 'Child destruction', statute: 's.1 Infant Life (Preservation) Act 1929', mode: 'IO' },
    ]},
    { group: 'Violence and assault', defaultMatterType: '1', offences: [
      { name: 'Common Assault', statute: 's.39 Criminal Justice Act 1988', mode: 'SO' },
      { name: 'Assault by beating', statute: 's.39 Criminal Justice Act 1988', mode: 'SO' },
      { name: 'Assault occasioning actual bodily harm (ABH)', statute: 's.47 OAPA 1861', mode: 'EW' },
      { name: 'Unlawful wounding / GBH', statute: 's.20 OAPA 1861', mode: 'EW' },
      { name: 'GBH with intent / Wounding with intent', statute: 's.18 OAPA 1861', mode: 'IO' },
      { name: 'Assault with intent to resist arrest', statute: 's.38 OAPA 1861', mode: 'EW' },
      { name: 'Assault on emergency worker', statute: 's.1 Assaults on Emergency Workers Act 2018', mode: 'EW' },
      { name: 'Making threats to kill', statute: 's.16 OAPA 1861', mode: 'EW' },
      { name: 'False imprisonment', statute: 'Common law', mode: 'IO' },
      { name: 'Kidnapping', statute: 'Common law', mode: 'IO' },
      { name: 'Administering poison / noxious substance with intent', statute: 's.24 OAPA 1861', mode: 'EW' },
      { name: 'Administering poison / noxious substance to endanger life', statute: 's.23 OAPA 1861', mode: 'IO' },
      { name: 'Choking / strangulation (non-fatal)', statute: 's.75A Serious Crime Act 2015', mode: 'EW', matterType: '19' },
      { name: 'Racially or religiously aggravated common assault', statute: 's.29 Crime and Disorder Act 1998', mode: 'EW' },
      { name: 'Racially or religiously aggravated ABH', statute: 's.29 Crime and Disorder Act 1998', mode: 'EW' },
      { name: 'Ill-treatment or wilful neglect (mental capacity)', statute: 's.44 Mental Capacity Act 2005', mode: 'EW' },
      { name: 'Causing bodily harm by explosives', statute: 's.28 OAPA 1861', mode: 'IO' },
      { name: 'Using explosives / corrosive substance with intent', statute: 's.29 OAPA 1861', mode: 'IO' },
      { name: 'Throwing corrosive fluid on a person', statute: 's.29 OAPA 1861', mode: 'IO' },
      { name: 'Setting trap to cause bodily harm', statute: 's.31 OAPA 1861', mode: 'EW' },
    ]},
    { group: 'Theft and burglary', defaultMatterType: '6', offences: [
      { name: 'Theft', statute: 's.1 Theft Act 1968', mode: 'EW' },
      { name: 'Theft from employer', statute: 's.1 Theft Act 1968', mode: 'EW' },
      { name: 'Theft from shop (shoplifting)', statute: 's.1 Theft Act 1968', mode: 'EW' },
      { name: 'Low-value shoplifting (under \u00A3200)', statute: 's.176 Anti-social Behaviour, Crime and Policing Act 2014', mode: 'SO' },
      { name: 'Burglary (dwelling)', statute: 's.9(1)(a) Theft Act 1968', mode: 'EW', matterType: '4' },
      { name: 'Burglary (non-dwelling)', statute: 's.9(1)(b) Theft Act 1968', mode: 'EW', matterType: '4' },
      { name: 'Aggravated burglary', statute: 's.10 Theft Act 1968', mode: 'IO', matterType: '4' },
      { name: 'Robbery', statute: 's.8 Theft Act 1968', mode: 'IO', matterType: '3' },
      { name: 'Armed robbery', statute: 's.8 Theft Act 1968', mode: 'IO', matterType: '3' },
      { name: 'Going equipped to steal', statute: 's.25 Theft Act 1968', mode: 'EW', matterType: '18' },
      { name: 'Handling stolen goods', statute: 's.22 Theft Act 1968', mode: 'EW' },
      { name: 'Making off without payment', statute: 's.3 Theft Act 1978', mode: 'EW', matterType: '18' },
      { name: 'Taking vehicle without consent (TWOC)', statute: 's.12 Theft Act 1968', mode: 'SO' },
      { name: 'Aggravated vehicle taking', statute: 's.12A Theft Act 1968', mode: 'EW' },
      { name: 'Removal of articles from place open to public', statute: 's.11 Theft Act 1968', mode: 'EW' },
      { name: 'Abstracting electricity', statute: 's.13 Theft Act 1968', mode: 'EW' },
      { name: 'Blackmail', statute: 's.21 Theft Act 1968', mode: 'IO', matterType: '18' },
      { name: 'Dishonestly retaining wrongful credit', statute: 's.24A Theft Act 1968', mode: 'EW', matterType: '18' },
      { name: 'Obtaining property by deception (legacy)', statute: 's.15 Theft Act 1968', mode: 'EW', matterType: '18' },
      { name: 'Theft of mail', statute: 's.14 Theft Act 1968', mode: 'EW' },
    ]},
    { group: 'Criminal damage and arson', defaultMatterType: '5', offences: [
      { name: 'Criminal damage', statute: 's.1(1) Criminal Damage Act 1971', mode: 'EW' },
      { name: 'Criminal damage (value under \u00A35,000)', statute: 's.1(1) Criminal Damage Act 1971', mode: 'SO' },
      { name: 'Aggravated criminal damage (endangering life)', statute: 's.1(2) Criminal Damage Act 1971', mode: 'IO' },
      { name: 'Arson', statute: 's.1(1) & (3) Criminal Damage Act 1971', mode: 'EW', matterType: '15' },
      { name: 'Arson with intent / reckless as to endangering life', statute: 's.1(2) & (3) Criminal Damage Act 1971', mode: 'IO', matterType: '15' },
      { name: 'Making threats to destroy or damage property', statute: 's.2 Criminal Damage Act 1971', mode: 'EW' },
      { name: 'Possession with intent to destroy or damage', statute: 's.3 Criminal Damage Act 1971', mode: 'EW' },
      { name: 'Racially or religiously aggravated criminal damage', statute: 's.30 Crime and Disorder Act 1998', mode: 'EW' },
    ]},
    { group: 'Public order', defaultMatterType: '8', offences: [
      { name: 'Disorderly behaviour (s.5)', statute: 's.5 Public Order Act 1986', mode: 'SO' },
      { name: 'Threatening / abusive words or behaviour (s.4)', statute: 's.4 Public Order Act 1986', mode: 'SO' },
      { name: 'Intentional harassment, alarm or distress (s.4A)', statute: 's.4A Public Order Act 1986', mode: 'EW' },
      { name: 'Fear or provocation of violence (s.4)', statute: 's.4 Public Order Act 1986', mode: 'SO' },
      { name: 'Violent disorder', statute: 's.2 Public Order Act 1986', mode: 'EW' },
      { name: 'Affray', statute: 's.3 Public Order Act 1986', mode: 'EW' },
      { name: 'Riot', statute: 's.1 Public Order Act 1986', mode: 'IO' },
      { name: 'Racially or religiously aggravated public order offence (s.31)', statute: 's.31 Crime and Disorder Act 1998', mode: 'EW' },
      { name: 'Stirring up racial hatred', statute: 's.18 Public Order Act 1986', mode: 'EW' },
      { name: 'Stirring up hatred on grounds of sexual orientation', statute: 's.29B Public Order Act 1986', mode: 'EW' },
      { name: 'Stirring up hatred on grounds of religion', statute: 's.29B Public Order Act 1986', mode: 'EW' },
      { name: 'Acts outraging public decency', statute: 'Common law', mode: 'EW' },
      { name: 'Causing nuisance or disturbance on NHS premises', statute: 's.119 Criminal Justice and Immigration Act 2008', mode: 'SO' },
      { name: 'Trespassing on designated site', statute: 's.128 Serious Organised Crime and Police Act 2005', mode: 'SO' },
      { name: 'Obstructing highway', statute: 's.137 Highways Act 1980', mode: 'SO' },
      { name: 'Drunk and disorderly in public', statute: 's.91 Criminal Justice Act 1967', mode: 'SO' },
      { name: 'Being found drunk in a highway / public place', statute: 's.12 Licensing Act 1872', mode: 'SO' },
      { name: 'Aggravated trespass', statute: 's.68 Criminal Justice and Public Order Act 1994', mode: 'SO' },
      { name: 'Failing to comply with direction to leave land', statute: 's.61 Criminal Justice and Public Order Act 1994', mode: 'SO' },
      { name: 'Breach of dispersal order', statute: 's.35 Anti-social Behaviour, Crime and Policing Act 2014', mode: 'SO' },
      { name: 'Wearing uniform with political object', statute: 's.1 Public Order Act 1936', mode: 'SO' },
    ]},
    { group: 'Harassment, stalking and domestic abuse', defaultMatterType: '19', offences: [
      { name: 'Harassment (s.2)', statute: 's.2 Protection from Harassment Act 1997', mode: 'EW' },
      { name: 'Harassment putting in fear of violence (s.4)', statute: 's.4 Protection from Harassment Act 1997', mode: 'EW' },
      { name: 'Stalking (s.2A)', statute: 's.2A Protection from Harassment Act 1997', mode: 'EW' },
      { name: 'Stalking involving fear of violence / serious alarm (s.4A)', statute: 's.4A Protection from Harassment Act 1997', mode: 'EW' },
      { name: 'Controlling or coercive behaviour', statute: 's.76 Serious Crime Act 2015', mode: 'EW' },
      { name: 'Breach of restraining order', statute: 's.5(5) Protection from Harassment Act 1997', mode: 'EW', matterType: '17' },
      { name: 'Breach of non-molestation order', statute: 's.42A Family Law Act 1996', mode: 'EW', matterType: '17' },
      { name: 'Breach of domestic abuse protection order', statute: 's.28 Domestic Abuse Act 2021', mode: 'EW', matterType: '17' },
      { name: 'Racially or religiously aggravated harassment (s.32)', statute: 's.32 Crime and Disorder Act 1998', mode: 'EW' },
      { name: 'Racially or religiously aggravated stalking', statute: 's.32 Crime and Disorder Act 1998', mode: 'EW' },
      { name: 'Threats to disclose private sexual photographs', statute: 's.33 Criminal Justice and Courts Act 2015', mode: 'EW' },
    ]},
    { group: 'Sexual offences', defaultMatterType: '2', offences: [
      { name: 'Rape', statute: 's.1 Sexual Offences Act 2003', mode: 'IO' },
      { name: 'Assault by penetration', statute: 's.2 Sexual Offences Act 2003', mode: 'IO' },
      { name: 'Sexual assault', statute: 's.3 Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Causing sexual activity without consent', statute: 's.4 Sexual Offences Act 2003', mode: 'IO' },
      { name: 'Rape of child under 13', statute: 's.5 Sexual Offences Act 2003', mode: 'IO' },
      { name: 'Assault of child under 13 by penetration', statute: 's.6 Sexual Offences Act 2003', mode: 'IO' },
      { name: 'Sexual assault of child under 13', statute: 's.7 Sexual Offences Act 2003', mode: 'IO' },
      { name: 'Causing / inciting child under 13 to engage in sexual activity', statute: 's.8 Sexual Offences Act 2003', mode: 'IO' },
      { name: 'Sexual activity with child under 16', statute: 's.9 Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Causing / inciting child to engage in sexual activity', statute: 's.10 Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Sexual activity in presence of child', statute: 's.11 Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Causing child to watch sexual act', statute: 's.12 Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Arranging / facilitating child sex offence', statute: 's.14 Sexual Offences Act 2003', mode: 'IO' },
      { name: 'Meeting child following sexual grooming', statute: 's.15 Sexual Offences Act 2003', mode: 'IO' },
      { name: 'Sexual communication with child', statute: 's.15A Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Abuse of position of trust (sexual)', statute: 'ss.16\u201319 Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Sexual activity with person with mental disorder', statute: 'ss.30\u201333 Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Causing / inciting prostitution for gain', statute: 's.52 Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Controlling prostitution for gain', statute: 's.53 Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Paying for sexual services of exploited person', statute: 's.53A Sexual Offences Act 2003', mode: 'SO' },
      { name: 'Keeping a brothel', statute: 's.33 Sexual Offences Act 1956', mode: 'EW' },
      { name: 'Voyeurism', statute: 's.67 Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Voyeurism (additional offences)', statute: 's.67A Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Exposure', statute: 's.66 Sexual Offences Act 2003', mode: 'EW' },
      { name: 'Administering substance with intent to stupefy (sexual)', statute: 's.61 Sexual Offences Act 2003', mode: 'IO' },
      { name: 'Possession of indecent image of child', statute: 's.160 Criminal Justice Act 1988', mode: 'EW' },
      { name: 'Making / taking indecent image of child', statute: 's.1 Protection of Children Act 1978', mode: 'EW' },
      { name: 'Distribution of indecent images of children', statute: 's.1(1)(b) Protection of Children Act 1978', mode: 'EW' },
      { name: 'Possession of extreme pornographic image', statute: 's.63 Criminal Justice and Immigration Act 2008', mode: 'EW' },
      { name: 'Possession of prohibited image of child', statute: 's.62 Coroners and Justice Act 2009', mode: 'EW' },
      { name: 'Disclosure of private sexual photographs (revenge porn)', statute: 's.33 Criminal Justice and Courts Act 2015', mode: 'EW' },
      { name: 'Failing to comply with sex offenders notification requirements', statute: 's.91 Sexual Offences Act 2003', mode: 'EW', matterType: '17' },
      { name: 'Breach of sexual harm prevention order', statute: 's.103I Sexual Offences Act 2003', mode: 'EW', matterType: '17' },
    ]},
    { group: 'Drug offences', defaultMatterType: '9', offences: [
      { name: 'Possession of Class A drug', statute: 's.5(1) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Possession of Class B drug', statute: 's.5(1) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Possession of Class C drug', statute: 's.5(1) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Possession with intent to supply Class A drug', statute: 's.5(3) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Possession with intent to supply Class B drug', statute: 's.5(3) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Possession with intent to supply Class C drug', statute: 's.5(3) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Supply / offering to supply Class A drug', statute: 's.4(1) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Supply / offering to supply Class B drug', statute: 's.4(1) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Supply / offering to supply Class C drug', statute: 's.4(1) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Being concerned in supply of Class A drug', statute: 's.4(3)(b) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Being concerned in supply of Class B drug', statute: 's.4(3)(b) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Being concerned in supply of Class C drug', statute: 's.4(3)(b) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Production of Class A drug', statute: 's.4(2) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Production of Class B drug', statute: 's.4(2) Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Production of cannabis', statute: 's.6 Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Cultivation of cannabis', statute: 's.6 Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Fraudulent evasion of drug controls (import/export)', statute: 's.170(2) CEMA 1979', mode: 'EW' },
      { name: 'Occupier / manager permitting drug use on premises', statute: 's.8 Misuse of Drugs Act 1971', mode: 'EW' },
      { name: 'Supply of psychoactive substance', statute: 's.5 Psychoactive Substances Act 2016', mode: 'EW' },
      { name: 'Production of psychoactive substance', statute: 's.4 Psychoactive Substances Act 2016', mode: 'EW' },
      { name: 'Possession of psychoactive substance in custodial institution', statute: 's.9 Psychoactive Substances Act 2016', mode: 'EW' },
      { name: 'Permitting supply of Class A drug on premises', statute: 's.8 Misuse of Drugs Act 1971', mode: 'EW' },
    ]},
    { group: 'Weapons and offensive articles', defaultMatterType: '16', offences: [
      { name: 'Possession of offensive weapon in public', statute: 's.1 Prevention of Crime Act 1953', mode: 'EW' },
      { name: 'Possession of offensive weapon on school premises', statute: 's.1 Prevention of Crime Act 1953', mode: 'EW' },
      { name: 'Threatening with offensive weapon in public', statute: 's.1A Prevention of Crime Act 1953', mode: 'EW' },
      { name: 'Possession of bladed or sharply pointed article in public', statute: 's.139 Criminal Justice Act 1988', mode: 'EW' },
      { name: 'Possession of bladed article on school premises', statute: 's.139A Criminal Justice Act 1988', mode: 'EW' },
      { name: 'Threatening with bladed article in public', statute: 's.139AA Criminal Justice Act 1988', mode: 'EW' },
      { name: 'Possession of offensive weapon in private (dwelling)', statute: 's.1 Prevention of Crime Act 1953 (as amended)', mode: 'EW' },
      { name: 'Possession of corrosive substance', statute: 's.6 Offensive Weapons Act 2019', mode: 'EW' },
      { name: 'Threatening with corrosive substance', statute: 's.7 Offensive Weapons Act 2019', mode: 'EW' },
      { name: 'Selling knife / blade to under 18', statute: 's.141A Criminal Justice Act 1988', mode: 'SO' },
      { name: 'Possession of firearm without certificate', statute: 's.1 Firearms Act 1968', mode: 'EW', matterType: '14' },
      { name: 'Possession of shotgun without certificate', statute: 's.2 Firearms Act 1968', mode: 'EW', matterType: '14' },
      { name: 'Possession of firearm with intent to endanger life', statute: 's.16 Firearms Act 1968', mode: 'IO', matterType: '14' },
      { name: 'Possession of firearm with intent to cause fear of violence', statute: 's.16A Firearms Act 1968', mode: 'IO', matterType: '14' },
      { name: 'Carrying loaded firearm in public place', statute: 's.19 Firearms Act 1968', mode: 'EW', matterType: '14' },
      { name: 'Possession of imitation firearm in public', statute: 's.19 Firearms Act 1968', mode: 'EW', matterType: '14' },
      { name: 'Possession of prohibited weapon', statute: 's.5 Firearms Act 1968', mode: 'IO', matterType: '14' },
      { name: 'Using firearm to resist arrest', statute: 's.17(1) Firearms Act 1968', mode: 'IO', matterType: '14' },
      { name: 'Shortening shotgun / converting firearm', statute: 's.4(1) Firearms Act 1968', mode: 'EW', matterType: '14' },
      { name: 'Trespassing with firearm in building', statute: 's.20(1) Firearms Act 1968', mode: 'EW', matterType: '14' },
    ]},
    { group: 'Driving offences', defaultMatterType: '10', offences: [
      { name: 'Drink driving (excess alcohol)', statute: 's.5 Road Traffic Act 1988', mode: 'SO' },
      { name: 'Drug driving (excess specified controlled drug)', statute: 's.5A Road Traffic Act 1988', mode: 'SO' },
      { name: 'Driving while unfit through drink or drugs', statute: 's.4 Road Traffic Act 1988', mode: 'SO' },
      { name: 'In charge of vehicle whilst over limit / unfit', statute: 's.4(2) / s.5(1)(b) Road Traffic Act 1988', mode: 'SO' },
      { name: 'Failing to provide specimen for analysis', statute: 's.7(6) Road Traffic Act 1988', mode: 'EW' },
      { name: 'Failing to provide preliminary breath specimen', statute: 's.6(4) Road Traffic Act 1988', mode: 'SO' },
      { name: 'Dangerous driving', statute: 's.2 Road Traffic Act 1988', mode: 'EW' },
      { name: 'Careless or inconsiderate driving', statute: 's.3 Road Traffic Act 1988', mode: 'SO' },
      { name: 'Causing death by dangerous driving', statute: 's.1 Road Traffic Act 1988', mode: 'IO' },
      { name: 'Causing serious injury by dangerous driving', statute: 's.1A Road Traffic Act 1988', mode: 'IO' },
      { name: 'Causing death by careless driving', statute: 's.2B Road Traffic Act 1988', mode: 'EW' },
      { name: 'Causing death by careless driving (drink/drugs)', statute: 's.3A Road Traffic Act 1988', mode: 'IO' },
      { name: 'Causing serious injury by careless driving (drink/drugs)', statute: 's.2C Road Traffic Act 1988', mode: 'EW' },
      { name: 'Causing death by driving while unlicensed / uninsured', statute: 's.3ZB Road Traffic Act 1988', mode: 'EW' },
      { name: 'Causing serious injury by careless driving', statute: 's.2C Road Traffic Act 1988', mode: 'EW' },
      { name: 'Fail to stop after accident', statute: 's.170 Road Traffic Act 1988', mode: 'EW' },
      { name: 'Fail to report accident', statute: 's.170 Road Traffic Act 1988', mode: 'SO' },
      { name: 'Driving whilst disqualified', statute: 's.103 Road Traffic Act 1988', mode: 'SO' },
      { name: 'Driving without insurance', statute: 's.143 Road Traffic Act 1988', mode: 'SO' },
      { name: 'Driving without licence', statute: 's.87 Road Traffic Act 1988', mode: 'SO' },
      { name: 'Speeding', statute: 's.89 Road Traffic Regulation Act 1984', mode: 'SO' },
      { name: 'Using vehicle without test certificate', statute: 's.47 Road Traffic Act 1988', mode: 'SO' },
      { name: 'Using vehicle in dangerous condition', statute: 's.40A Road Traffic Act 1988', mode: 'SO' },
      { name: 'Using motor vehicle without third party insurance', statute: 's.143 Road Traffic Act 1988', mode: 'SO' },
      { name: 'Driving with uncorrected defective eyesight', statute: 's.96 Road Traffic Act 1988', mode: 'SO' },
      { name: 'Failing to identify driver', statute: 's.172 Road Traffic Act 1988', mode: 'SO' },
      { name: 'Fraudulent use of vehicle excise licence / registration', statute: 's.44 Vehicle Excise and Registration Act 1994', mode: 'SO' },
    ]},
    { group: 'Fraud and economic crime', defaultMatterType: '7', offences: [
      { name: 'Fraud (false representation)', statute: 's.2 Fraud Act 2006', mode: 'EW' },
      { name: 'Fraud (failing to disclose)', statute: 's.3 Fraud Act 2006', mode: 'EW' },
      { name: 'Fraud (abuse of position)', statute: 's.4 Fraud Act 2006', mode: 'EW' },
      { name: 'Conspiracy to defraud', statute: 'Common law', mode: 'IO' },
      { name: 'Obtaining services dishonestly', statute: 's.11 Fraud Act 2006', mode: 'EW' },
      { name: 'Possession of articles for use in fraud', statute: 's.6 Fraud Act 2006', mode: 'EW' },
      { name: 'Making or supplying articles for use in fraud', statute: 's.7 Fraud Act 2006', mode: 'EW' },
      { name: 'Participating in fraudulent business', statute: 's.9 Fraud Act 2006', mode: 'EW' },
      { name: 'False accounting', statute: 's.17 Theft Act 1968', mode: 'EW' },
      { name: 'Money laundering', statute: 's.327 Proceeds of Crime Act 2002', mode: 'EW', matterType: '21' },
      { name: 'Acquisition / use / possession of criminal property', statute: 's.329 Proceeds of Crime Act 2002', mode: 'EW', matterType: '21' },
      { name: 'Concealing / disguising / converting criminal property', statute: 's.327 Proceeds of Crime Act 2002', mode: 'EW', matterType: '21' },
      { name: 'Failure to disclose (regulated sector)', statute: 's.330 Proceeds of Crime Act 2002', mode: 'EW', matterType: '21' },
      { name: 'Tipping off', statute: 's.333A Proceeds of Crime Act 2002', mode: 'EW', matterType: '21' },
      { name: 'Bribery', statute: 's.1 Bribery Act 2010', mode: 'EW' },
      { name: 'Being bribed', statute: 's.2 Bribery Act 2010', mode: 'EW' },
      { name: 'Tax evasion (cheating public revenue)', statute: 'Common law', mode: 'IO' },
      { name: 'Tax credit fraud', statute: 's.35 Tax Credits Act 2002', mode: 'EW' },
      { name: 'Benefit fraud', statute: 's.111A Social Security Administration Act 1992', mode: 'EW' },
      { name: 'VAT fraud', statute: 's.72 Value Added Tax Act 1994', mode: 'EW' },
      { name: 'Insider dealing', statute: 's.52 Criminal Justice Act 1993', mode: 'EW' },
    ]},
    { group: 'Forgery and document offences', defaultMatterType: '7', offences: [
      { name: 'Forgery', statute: 's.1 Forgery and Counterfeiting Act 1981', mode: 'EW' },
      { name: 'Using a false instrument', statute: 's.3 Forgery and Counterfeiting Act 1981', mode: 'EW' },
      { name: 'Copying a false instrument', statute: 's.2 Forgery and Counterfeiting Act 1981', mode: 'EW' },
      { name: 'Using copy of false instrument', statute: 's.4 Forgery and Counterfeiting Act 1981', mode: 'EW' },
      { name: 'Possession of false identity documents', statute: 's.6 Identity Documents Act 2010', mode: 'EW' },
      { name: 'Possession of false identity documents with intent', statute: 's.4 Identity Documents Act 2010', mode: 'EW' },
      { name: 'Forgery of driving documents', statute: 's.173 Road Traffic Act 1988', mode: 'EW' },
      { name: 'Counterfeiting notes or coins', statute: 's.14 Forgery and Counterfeiting Act 1981', mode: 'EW' },
      { name: 'Passing counterfeit notes or coins', statute: 's.15 Forgery and Counterfeiting Act 1981', mode: 'EW' },
    ]},
    { group: 'Cyber and communications offences', defaultMatterType: '11', offences: [
      { name: 'Malicious communications', statute: 's.1 Malicious Communications Act 1988', mode: 'EW' },
      { name: 'Sending indecent / grossly offensive communications', statute: 's.127 Communications Act 2003', mode: 'SO' },
      { name: 'Improper use of public electronic communications', statute: 's.127 Communications Act 2003', mode: 'SO' },
      { name: 'Computer misuse (unauthorised access)', statute: 's.1 Computer Misuse Act 1990', mode: 'EW' },
      { name: 'Computer misuse (unauthorised access with intent)', statute: 's.2 Computer Misuse Act 1990', mode: 'IO' },
      { name: 'Computer misuse (unauthorised modification)', statute: 's.3 Computer Misuse Act 1990', mode: 'EW' },
      { name: 'Computer misuse (making / supplying hacking tools)', statute: 's.3A Computer Misuse Act 1990', mode: 'EW' },
      { name: 'False communication causing public harm (Online Safety Act)', statute: 's.179 Online Safety Act 2023', mode: 'EW' },
      { name: 'Sending threatening communication', statute: 's.181 Online Safety Act 2023', mode: 'EW' },
      { name: 'Sending communication that is false / persistently used to cause anxiety', statute: 's.127 Communications Act 2003', mode: 'SO' },
      { name: 'Harassment by means of electronic communications', statute: 's.2 Protection from Harassment Act 1997', mode: 'EW' },
      { name: 'Data protection offences (unlawful obtaining)', statute: 's.170 Data Protection Act 2018', mode: 'EW' },
    ]},
    { group: 'Modern slavery and trafficking', defaultMatterType: '20', offences: [
      { name: 'Holding person in slavery or servitude', statute: 's.1 Modern Slavery Act 2015', mode: 'IO' },
      { name: 'Requiring person to perform forced or compulsory labour', statute: 's.1 Modern Slavery Act 2015', mode: 'IO' },
      { name: 'Human trafficking', statute: 's.2 Modern Slavery Act 2015', mode: 'IO' },
      { name: 'Arranging / facilitating travel for exploitation', statute: 's.2 Modern Slavery Act 2015', mode: 'IO' },
      { name: 'Committing offence with intent to commit trafficking', statute: 's.4 Modern Slavery Act 2015', mode: 'IO' },
    ]},
    { group: 'Immigration offences', defaultMatterType: '20', offences: [
      { name: 'Assisting unlawful immigration', statute: 's.25 Immigration Act 1971', mode: 'EW' },
      { name: 'Facilitating breach of immigration law (for gain)', statute: 's.25A Immigration Act 1971', mode: 'IO' },
      { name: 'Harbouring persons who have entered illegally', statute: 's.25 Immigration Act 1971', mode: 'EW' },
      { name: 'Possession of false identity documents (immigration)', statute: 's.4 Identity Documents Act 2010', mode: 'EW' },
      { name: 'Entering UK without leave', statute: 's.24 Immigration Act 1971', mode: 'EW' },
      { name: 'Employing illegal worker', statute: 's.21 Immigration, Asylum and Nationality Act 2006', mode: 'EW' },
      { name: 'Illegal entry into UK', statute: 's.24(1)(a) Immigration Act 1971', mode: 'EW' },
      { name: 'Overstaying leave', statute: 's.24(1)(b) Immigration Act 1971', mode: 'SO' },
      { name: 'Deception to obtain leave to remain', statute: 's.24A Immigration Act 1971', mode: 'EW' },
    ]},
    { group: 'Terrorism offences', defaultMatterType: '20', offences: [
      { name: 'Preparation of terrorist acts', statute: 's.5 Terrorism Act 2006', mode: 'IO' },
      { name: 'Encouragement of terrorism', statute: 's.1 Terrorism Act 2006', mode: 'IO' },
      { name: 'Dissemination of terrorist publication', statute: 's.2 Terrorism Act 2006', mode: 'IO' },
      { name: 'Collection of information useful for terrorism', statute: 's.58 Terrorism Act 2000', mode: 'EW' },
      { name: 'Possession of article for terrorist purposes', statute: 's.57 Terrorism Act 2000', mode: 'IO' },
      { name: 'Failure to disclose information about terrorism', statute: 's.38B Terrorism Act 2000', mode: 'EW' },
      { name: 'Fund-raising for terrorism', statute: 's.15 Terrorism Act 2000', mode: 'IO' },
      { name: 'Use / possession of money for terrorism', statute: 's.16 Terrorism Act 2000', mode: 'IO' },
      { name: 'Membership of proscribed organisation', statute: 's.11 Terrorism Act 2000', mode: 'IO' },
      { name: 'Support for proscribed organisation', statute: 's.12 Terrorism Act 2000', mode: 'IO' },
      { name: 'Attending a place used for terrorist training', statute: 's.8 Terrorism Act 2006', mode: 'IO' },
    ]},
    { group: 'Offences against justice and administration', defaultMatterType: '13', offences: [
      { name: 'Perverting the course of justice', statute: 'Common law', mode: 'IO' },
      { name: 'Conspiracy to pervert the course of justice', statute: 'Common law / s.1 Criminal Law Act 1977', mode: 'IO' },
      { name: 'Perjury', statute: 's.1 Perjury Act 1911', mode: 'IO' },
      { name: 'Concealing a criminal offence', statute: 's.5 Criminal Law Act 1967', mode: 'EW' },
      { name: 'Assisting offenders', statute: 's.4(1) Criminal Law Act 1967', mode: 'EW' },
      { name: 'Misconduct in public office', statute: 'Common law', mode: 'IO' },
      { name: 'Escape from lawful custody', statute: 's.39 Prison Act 1952', mode: 'EW' },
      { name: 'Absconding from lawful custody', statute: 's.39 Prison Act 1952', mode: 'EW' },
      { name: 'Breach of bail', statute: 's.6 Bail Act 1976', mode: 'SO' },
      { name: 'Failing to surrender to custody', statute: 's.6 Bail Act 1976', mode: 'SO' },
      { name: 'Contempt of court', statute: 'Common law / Contempt of Court Act 1981', mode: 'EW' },
      { name: 'Intimidating witness', statute: 's.51(1) Criminal Justice and Public Order Act 1994', mode: 'EW' },
      { name: 'Intimidating juror', statute: 's.51(2) Criminal Justice and Public Order Act 1994', mode: 'EW' },
      { name: 'Obstructing a constable', statute: 's.89(2) Police Act 1996', mode: 'SO' },
      { name: 'Resisting / obstructing arrest', statute: 's.89(1) Police Act 1996', mode: 'SO' },
      { name: 'Wasting police time', statute: 's.5(2) Criminal Law Act 1967', mode: 'SO' },
      { name: 'Making false statement to obtain certificate', statute: 's.174 Road Traffic Act 1988', mode: 'SO' },
      { name: 'Failure to comply with notification requirements (various)', statute: 'Various statutes', mode: 'SO' },
    ]},
    { group: 'Inchoate offences (attempt, conspiracy, encouraging)', defaultMatterType: '11', offences: [
      { name: 'Attempt (any offence)', statute: 's.1 Criminal Attempts Act 1981', mode: 'EW' },
      { name: 'Conspiracy (statutory)', statute: 's.1 Criminal Law Act 1977', mode: 'EW' },
      { name: 'Encouraging or assisting believing offence will be committed', statute: 's.44 Serious Crime Act 2007', mode: 'EW' },
      { name: 'Encouraging or assisting believing offence may be committed', statute: 's.45 Serious Crime Act 2007', mode: 'EW' },
      { name: 'Encouraging or assisting (one or more offences)', statute: 's.46 Serious Crime Act 2007', mode: 'EW' },
      { name: 'Aiding, abetting, counselling or procuring', statute: 's.8 Accessories and Abettors Act 1861', mode: 'EW' },
    ]},
    { group: 'Children, animal welfare and other', defaultMatterType: '11', offences: [
      { name: 'Cruelty to persons under 16', statute: 's.1 Children and Young Persons Act 1933', mode: 'EW' },
      { name: 'Child neglect', statute: 's.1 Children and Young Persons Act 1933', mode: 'EW' },
      { name: 'Allowing child to be used for begging', statute: 's.4 Children and Young Persons Act 1933', mode: 'EW' },
      { name: 'Sale of alcohol to person under 18', statute: 's.146 Licensing Act 2003', mode: 'SO' },
      { name: 'Sale of tobacco to person under 18', statute: 's.7 Children and Young Persons Act 1933', mode: 'SO' },
      { name: 'Cruelty to animals', statute: 's.4 Animal Welfare Act 2006', mode: 'EW' },
      { name: 'Causing unnecessary suffering to animal', statute: 's.4 Animal Welfare Act 2006', mode: 'EW' },
      { name: 'Animal fighting', statute: 's.8 Animal Welfare Act 2006', mode: 'EW' },
      { name: 'Dangerous dogs (out of control)', statute: 's.3 Dangerous Dogs Act 1991', mode: 'EW' },
      { name: 'Dangerous dogs causing injury', statute: 's.3(1) Dangerous Dogs Act 1991', mode: 'EW' },
      { name: 'Possession of dangerous dog (prohibited type)', statute: 's.1 Dangerous Dogs Act 1991', mode: 'EW' },
      { name: 'Breach of community order / suspended sentence', statute: 'Sch.12 Criminal Justice Act 2003', mode: 'EW', matterType: '17' },
      { name: 'Breach of criminal behaviour order', statute: 's.30 Anti-social Behaviour, Crime and Policing Act 2014', mode: 'EW', matterType: '17' },
      { name: 'Begging', statute: 's.3 Vagrancy Act 1824', mode: 'SO' },
      { name: 'Fly-tipping (unlawful deposit of waste)', statute: 's.33 Environmental Protection Act 1990', mode: 'EW' },
      { name: 'Environmental offences (pollution)', statute: 'Environmental Protection Act 1990 / Environment Act 1995', mode: 'EW' },
      { name: 'Noise nuisance (statutory)', statute: 's.80 Environmental Protection Act 1990', mode: 'SO' },
      { name: 'Failure to comply with closure order (premises)', statute: 's.86 Anti-social Behaviour, Crime and Policing Act 2014', mode: 'EW', matterType: '17' },
    ]},
  ];

  /* ─── TEMPLATE PHRASES for quick-insert into textareas ─── */
var TEMPLATE_PHRASES = {
    disclosureNarrative: [
      'Prosecution allege that on [DATE] at [LOCATION] the suspect [ALLEGATION].',
      'Complainant states [SUMMARY]. No independent witnesses identified.',
      'Officers attended and arrested client on suspicion of [OFFENCE]. Voluntary attendance.',
      'Body-worn camera footage available but not yet disclosed.',
      'Insufficient disclosure provided. No written MG11 statements seen.',
      'Disclosure Officer confirmed no forensic/DNA evidence at this stage.',
    ],
    clientInstructions: [
      'Client denies the allegation in its entirety.',
      'Client accepts being present but denies any involvement.',
      'Client states acting in self-defence / defence of another.',
      'Client provides an alibi for the time in question.',
      'Client confirms the account but states it was consensual.',
      'Client wishes to make no comment but provides a prepared statement.',
      'Client admits the offence and wishes to cooperate fully.',
    ],
    lawElements: [
      'Prosecution must prove: (1) unlawful force (2) applied to the person of another (3) intentionally or recklessly.',
      'Prosecution must prove: (1) dishonest (2) appropriation (3) of property belonging to another (4) with intention to permanently deprive.',
      'Prosecution must prove: (1) intentionally/recklessly causing (2) actual bodily harm (3) to the complainant.',
    ],
    reasonsForAdvice: [
      'Advised no comment \u2013 insufficient disclosure; risk of adverse inferences outweighed by lack of evidence.',
      'Advised no comment \u2013 client vulnerable / fatigued / unfit to give a reliable account.',
      'Advised no comment \u2013 complex allegations requiring further analysis before responding.',
      'Advised no comment \u2013 insufficient disclosure at this stage to advise meaningfully.',
      'Advised prepared statement \u2013 limited disclosure but client wishes account on record early.',
      'Advised prepared statement \u2013 client denies but risks of live interview outweigh benefits.',
      'Advised to answer questions \u2013 strong defence, nothing to hide, benefit of early account.',
      'Advised to answer questions \u2013 client admits offence, full cooperation appropriate.',
      'Advised to answer questions with caution \u2013 answer selectively on key points.',
      'Advised mixed approach \u2013 answer background questions, no comment on key allegations.',
    ],
    attendingOthersNotes: [
      'Spoke to OIC re: disclosure. Requested further details.',
      'Contacted CPS Direct re: charging decision.',
      'Spoke to custody sergeant re: welfare of client.',
      'Requested appropriate adult / interpreter.',
    ],
    notesToOffice: [
      'Case concluded at station. File ready for billing.',
      'Further attendance likely. Client bailed to return.',
      'Escape fee case - CRM18 required.',
      'Client released NFA. No further action anticipated.',
    ],
  };

  /* Interview-specific templates */
var IV_TEMPLATES = {
    notes: [
      'No comment to all questions put. Client remained silent throughout.',
      'Client answered all questions openly. See transcript for details.',
      'Client provided a prepared statement (copy attached). No comment thereafter.',
      'Mixed interview - client answered some questions, no comment to others.',
    ],
  };

  /* ─── LAA RATES (post 22 Dec 2025 harmonised) ─── */
var LAA = {
    fixedFee: 320.00,
    escapeThreshold: 650.00,
    mileageRate: 0.45,
    vatRate: 0.20,
    national: {
      attendance: { social: 54.57, unsocial: 72.46 },
      travel:     { social: 27.29, unsocial: 27.29 },
      waiting:    { social: 27.29, unsocial: 27.29 }
    }
  };

  /* ═══════════════════════════════════════════════════════════════
     SECTION DEFINITIONS – ordered as a rep works at the station
     ═══════════════════════════════════════════════════════════════ */
  const formSections = [
    /* ─────── 1. CASE REFERENCE & ARRIVAL ─────── */
    {
      id: 'caseArrival', title: '1. Case Reference & Arrival',
      keyFields: ['date', 'policeStationId', 'firmId', 'forename', 'surname', 'oicName', 'ourFileNumber', 'sufficientBenefitTest'],
      fields: [
        { key: 'ourFileNumber', label: 'File number (ours) / Invoice number', type: 'text', placeholder: 'Type invoice number (auto-assigned on create if left blank)' },
        { key: '_h_referral', label: 'Instruction / Referral', type: 'sectionHeading' },
        { key: '_h_time', label: 'Time (instruction)', type: 'sectionHeading' },
        { key: 'instructionDateTime', label: 'Date & time instruction received', type: 'datetime-local' },
        { key: 'firstContactWithin45Mins', label: 'First contact within 45 mins of instruction?', type: 'select', options: ['Yes','No'], helpTitle: 'LAA requires first contact within 45 mins in 80% of matters. If No, reason must be noted.' },
        { key: 'firstContactOver45MinsReason', label: 'Reason first contact exceeded 45 mins', type: 'textarea', placeholder: 'Required if first contact was more than 45 mins after instruction received (Spec 9.25)', cols: 2, showIf: { field: 'firstContactWithin45Mins', value: 'No' } },
        { key: 'firmId', label: 'Instructing Firm', type: 'firm', cols: 2 },
        { key: 'firmContactName', label: 'Contact at Firm', type: 'text', placeholder: 'e.g. Richard Chamberlain' },
        { key: 'firmContactPhone', label: 'Contact phone', type: 'tel' },
        { key: 'firmContactEmail', label: 'Contact email', type: 'email' },
        { type: 'nameRow', label: 'Client Name', fields: [
            { key: 'forename', label: 'First name', placeholder: 'First name' },
            { key: 'middleName', label: 'Middle name(s)', placeholder: 'Middle' },
            { key: 'surname', label: 'Surname', placeholder: 'Surname' }
          ], cols: 2 },
        { key: 'offenceSummary', label: 'Offence (summary)', type: 'offenceSummary', placeholder: 'Type to search offences...', cols: 2 },
        { key: 'policeStationId', label: 'Police Station', type: 'station', cols: 2 },
        { key: 'schemeId', label: 'Police Station Scheme ID', type: 'text', placeholder: 'Auto-filled from station', readonly: true },
        { key: 'dsccRef', label: 'DSCC Number (10 chars)', type: 'text', placeholder: 'e.g. 110154321A' },
        { key: 'oicName', label: 'OIC Rank & Name', type: 'text', cols: 2 },
        { key: 'oicEmail', label: 'OIC Email address', type: 'email' },
        { key: 'oicPhone', label: "OIC Telephone", type: 'tel' },

        { key: '_h_caseInfo', label: 'Case Information', type: 'sectionHeading' },
        { key: 'weekendBankHoliday', label: 'Weekend / Bank Holiday?', type: 'select', options: ['Yes','No'] },
        { key: 'otherLocation', label: 'Other Location (if not listed)', type: 'text', cols: 2 },
        { key: 'sourceOfReferral', label: 'Source of Referral', type: 'select', options: ['Duty Rota','Duty panel','Own Legal Aid','Own private','Agency'] },
        { key: 'workType', label: 'Work Type', type: 'select', options: ['First Police Station Attendance','Police Station Telephone Attendance','Further Police Station Attendance','Other'] },
        { key: 'dutySolicitor', label: 'Duty Solicitor?', type: 'select', options: ['Yes','No'] },
        { key: 'clientStatus', label: 'Client Status', type: 'select', options: ['Under Arrest','Voluntary Attendance','Other'] },
        { key: 'caseStatus', label: 'Case Status', type: 'select', options: ['New case','Existing case'] },
        { key: 'telephoneAdviceGiven', label: 'Telephone advice already given?', type: 'select', options: ['Yes','No','Not known'] },
        { key: 'feeEarnerTelephoneAdvice', label: 'Name of Fee Earner who provided Telephone Advice', type: 'text', placeholder: 'e.g. Jane Smith', helpTitle: 'Name of the fee earner who gave telephone advice to the client, if applicable.', cols: 2 },
        { key: 'arrivalNotes', label: 'General Notes', type: 'textarea', placeholder: 'General notes about the case or attendance', cols: 2 },
        { key: '_h_sbt', label: 'Sufficient Benefit Test (LAA)', type: 'sectionHeading' },
        { key: 'sufficientBenefitTest', label: 'Sufficient Benefit Test (LAA)', type: 'checkboxGroup', options: [
          'Police station attendance \u2013 interview',
          'Police station attendance \u2013 interview, advise on caution',
          'Police station attendance \u2013 interview, charge',
          'Telephone advice only',
          'Post-charge attendance',
          'Warrant of further detention'
        ], cols: 2 },
        { key: 'sufficientBenefitNotes', label: 'SBT Additional Notes', type: 'textarea', placeholder: 'Any additional details about the sufficient benefit provided', cols: 2 },
      ],
    },

    /* ─────── 2. JOURNEY TO STATION ─────── */
    {
      id: 'journeyTime', title: '2. Journey to Station',
      keyFields: ['timeSetOff', 'timeArrival'],
      fields: [
        { key: 'alreadyAtStation', label: 'Already at the station?', type: 'select', options: ['Yes','No'] },
        { key: 'travelOriginPostcode', label: 'Origin postcode', type: 'text', placeholder: 'e.g. ME1 1AA' },
        { key: 'timeSetOff', label: 'Time set off', type: 'time' },
        { key: 'timeArrival', label: 'Time of arrival at station', type: 'time' },
      ],
    },

    /* ─────── 3. CUSTODY RECORD ─────── */
    {
      id: 'custody', title: '3. Custody Record',
      keyFields: ['custodyNumber', 'groundsForArrest', 'dateOfArrest'],
      fields: [
        { key: '_h_custody_record', label: 'Custody Record', type: 'sectionHeading' },
        { key: 'custodyNumber', label: 'Custody Number', type: 'text' },
        { key: 'custodyRecordRead', label: 'Custody record read?', type: 'select', options: ['Yes','No'] },
        { key: '_h_client_from_record', label: 'Client Details (from custody record)', type: 'sectionHeading' },
        { key: 'title', label: 'Title', type: 'select', options: ['Mr','Mrs','Miss','Ms','Mx','Dr','Other'] },
        { type: 'nameRow', label: 'Name', fields: [
            { key: 'forename', label: 'First name' },
            { key: 'middleName', label: 'Middle name(s)' },
            { key: 'surname', label: 'Surname' }
          ], cols: 2 },
        { key: 'dob', label: 'Date of Birth', type: 'date' },
        { key: 'gender', label: 'Gender', type: 'select', options: ['Male','Female','Other','Prefer not to say'] },
        { key: 'nationality', label: 'Nationality', type: 'select', options: [
          'British','Irish','Polish','Romanian','Indian','Pakistani','Bangladeshi','Nigerian','Jamaican','Somali','Albanian','Afghan','Iraqi','Iranian','Eritrean','Sudanese','Ethiopian','Vietnamese','Chinese','Lithuanian','Latvian','Portuguese','Italian','Spanish','French','German','Turkish','Sri Lankan','Ghanaian','Zimbabwean','South African','Brazilian','Colombian','American','Canadian','Australian','Dual nationality','Stateless','Unknown','Other'
        ] },
        { key: 'nationalityOther', label: 'Other nationality (specify)', type: 'text', placeholder: 'Type nationality not listed', showIf: { field: 'nationality', value: 'Other' } },
        { key: 'address1', label: 'Address line 1', type: 'text', placeholder: 'House number and street', cols: 2 },
        { key: 'address2', label: 'Address line 2', type: 'text', cols: 2 },
        { key: 'address3', label: 'Address line 3', type: 'text', cols: 2 },
        { key: 'city', label: 'City / Town', type: 'text' },
        { key: 'county', label: 'County', type: 'text' },
        { key: 'postCode', label: 'Post Code', type: 'text' },
        { key: '_h_client_contact', label: 'Client contact (if known)', type: 'sectionHeading' },
        { key: 'clientPhone', label: 'Client telephone', type: 'tel', placeholder: 'If known — syncs with consultation' },
        { key: 'clientEmail', label: 'Client email address', type: 'email', placeholder: 'If known — syncs with consultation' },
        { key: 'custodyRecordIssues', label: 'Custody record issues', type: 'textarea', placeholder: 'Any issues or observations', cols: 2 },
        { key: 'arrestingOfficerName', label: 'Arresting Officer Rank & Name', type: 'text', cols: 2 },
        { key: 'arrestingOfficerNumber', label: 'Arresting Officer Collar / Badge No.', type: 'text' },

        { key: '_h_arrest', label: 'Arrest & Detention', type: 'sectionHeading' },
        { key: 'voluntaryInterview', label: 'Voluntary Interview?', type: 'select', options: ['Yes','No'] },
        { key: '_note_voluntary', label: 'If voluntary interview, arrest/detention grounds and PACE clock do not apply.', type: 'sectionNote' },
        { key: 'groundsForArrest', label: 'Grounds for Arrest (PACE s.24)', type: 'checkboxGroup', cols: 2, allowOther: true, options: [
          'To ascertain the person\'s name/address',
          'To prevent physical injury to self or others',
          'To prevent damage to property',
          'To prevent an offence against public decency',
          'To protect a child or vulnerable person',
          'To allow prompt and effective investigation',
          'To exercise search powers under PACE',
          'To prevent disappearance of the person'
        ] },
        { key: 'groundsForDetention', label: 'Grounds for Detention (PACE s.37)', type: 'checkboxGroup', cols: 2, allowOther: true, options: [
          'To secure or preserve evidence',
          'To obtain evidence by questioning',
          'Insufficient evidence to charge \u2013 further investigation needed'
        ] },
        { key: 'dateOfArrest', label: 'Date of Arrest', type: 'date' },
        { key: 'timeOfArrest', label: 'Time of Arrest', type: 'time' },
        { key: 'timeArrivalStation', label: 'Time Arrived at Station', type: 'time' },
        { key: 'relevantTime', label: 'Relevant Time (auto = detention authorised)', type: 'time', readonly: true },
        { key: 'timeDetentionAuthorised', label: 'Detention Authorised', type: 'time' },

        { key: '_h_pace_reviews', label: 'PACE Reviews', type: 'sectionHeading' },
        { key: 'firstReviewDue', label: '1st Review due (6 hrs)', type: 'time', readonly: true },
        { key: 'firstReviewActual', label: '1st Review \u2013 Actual Time', type: 'time' },
        { key: 'firstReviewNotes', label: '1st Review Notes', type: 'textarea', placeholder: 'Notes from 1st review', cols: 2 },
        { key: 'showMoreReviews', label: 'Further PACE reviews needed?', type: 'select', options: ['No','Yes'] },
        { key: 'secondReviewDue', label: '2nd Review due (15 hrs)', type: 'time', readonly: true, showIf: { field: 'showMoreReviews', value: 'Yes' } },
        { key: 'secondReviewActual', label: '2nd Review \u2013 Actual Time', type: 'time', showIf: { field: 'showMoreReviews', value: 'Yes' } },
        { key: 'secondReviewNotes', label: '2nd Review Notes', type: 'textarea', placeholder: 'Notes from 2nd review', cols: 2, showIf: { field: 'showMoreReviews', value: 'Yes' } },
        { key: 'thirdReviewDue', label: '3rd Review due (24 hrs)', type: 'time', readonly: true, showIf: { field: 'showMoreReviews', value: 'Yes' } },
        { key: 'thirdReviewActual', label: '3rd Review \u2013 Actual Time', type: 'time', showIf: { field: 'showMoreReviews', value: 'Yes' } },
        { key: 'thirdReviewNotes', label: '3rd Review Notes', type: 'textarea', placeholder: 'Notes from 3rd review', cols: 2, showIf: { field: 'showMoreReviews', value: 'Yes' } },

        { key: '_h_welfare', label: 'Welfare & Vulnerability', type: 'sectionHeading' },
        { key: '_note_foreign_national', label: 'If client is a foreign national, they have the right to have their consulate notified (PACE s.56A). Consider interpreter requirements.', type: 'sectionNote' },
        { key: 'languageIssues', label: 'Language issues?', type: 'select', options: ['Yes','No'] },
        { key: 'interpreterName', label: 'Interpreter name', type: 'text', showIf: { field: 'languageIssues', value: 'Yes' } },
        { key: 'interpreterLanguage', label: 'Language required', type: 'text', showIf: { field: 'languageIssues', value: 'Yes' } },
        { key: 'juvenileVulnerable', label: 'Juvenile / Vulnerable?', type: 'select', options: ['Not Applicable','Juvenile','Vulnerable Adult'] },
        { key: 'appropriateAdultName', label: 'Appropriate Adult name', type: 'text', showIf: { field: 'juvenileVulnerable', values: ['Juvenile','Vulnerable Adult'] } },
        { key: 'appropriateAdultRelation', label: 'AA relationship to client', type: 'text', showIf: { field: 'juvenileVulnerable', values: ['Juvenile','Vulnerable Adult'] } },
        { key: 'appropriateAdultPhone', label: 'AA contact number', type: 'tel', showIf: { field: 'juvenileVulnerable', values: ['Juvenile','Vulnerable Adult'] } },
        { key: 'appropriateAdultEmail', label: 'AA email', type: 'email', showIf: { field: 'juvenileVulnerable', values: ['Juvenile','Vulnerable Adult'] } },
        { key: 'appropriateAdultOrganisation', label: 'AA organisation (if applicable)', type: 'text', cols: 2, showIf: { field: 'juvenileVulnerable', values: ['Juvenile','Vulnerable Adult'] } },
        { key: 'appropriateAdultAddress', label: 'AA address (if needed)', type: 'textarea', cols: 2, showIf: { field: 'juvenileVulnerable', values: ['Juvenile','Vulnerable Adult'] } },
        { key: 'injuriesToClient', label: 'Injuries to client?', type: 'select', options: ['Yes','No'] },
        { key: 'injuryDetails', label: 'Injury details', type: 'text', cols: 2, showIf: { field: 'injuriesToClient', value: 'Yes' } },
        { key: 'photosOfInjuriesRequested', label: 'Photos of injuries requested?', type: 'select', options: ['Yes','No'], showIf: { field: 'injuriesToClient', value: 'Yes' } },
        { key: 'medication', label: 'Medication', type: 'text', placeholder: 'Not applicable or list', cols: 2 },
        { key: 'psychiatricIssues', label: 'Psychiatric / mental health issues?', type: 'select', options: ['Yes','No'] },
        { key: 'psychiatricNotes', label: 'Psychiatric / mental health notes', type: 'text', cols: 2, showIf: { field: 'psychiatricIssues', value: 'Yes' } },
        { key: 'literate', label: 'Literate / can read?', type: 'select', options: ['Yes','No'] },
        { key: 'drugsTest', label: 'Drugs test', type: 'select', options: ['Not applicable','Required','Refused','Done'] },
        { key: 'fmeNurse', label: 'FME / Nurse / Doctor required?', type: 'select', options: ['Yes','No'] },
        { key: 'medicalExaminationOutcome', label: 'Outcome of medical examination', type: 'textarea', placeholder: 'e.g. Fit to detain; injuries noted; referred to hospital; medication given', cols: 2, showIf: { field: 'fmeNurse', value: 'Yes' } },
        { key: 'fitToBeDetained', label: 'Fit to be detained?', type: 'select', options: ['Yes','No'] },
        { key: 'fitToBeInterviewed', label: 'Fit to be interviewed?', type: 'select', options: ['Yes','No'] },
      ],
    },

    /* ─────── 4. OFFENCES ─────── */
    {
      id: 'offences', title: '4. Offences',
      keyFields: ['matterTypeCode', 'offence1Details'],
      fields: [
        { key: 'matterTypeCode', label: 'Matter Type', type: 'codedSelect', codeKey: 'matterTypeCodes', cols: 2 },
        { key: 'offence1Details', label: 'Offence 1 – Details', type: 'offence', cols: 2 },
        { key: 'offence1Date', label: 'Date of Offence 1', type: 'date' },
        { key: 'offence1ModeOfTrial', label: 'Mode of Trial 1', type: 'codedSelect', codeKey: 'modeOfTrial' },
        { key: 'offence1Statute', label: 'Statute 1', type: 'text', cols: 2 },
        { key: 'offence2Details', label: 'Offence 2 – Details', type: 'offence', cols: 2 },
        { key: 'offence2Date', label: 'Date of Offence 2', type: 'date' },
        { key: 'offence2ModeOfTrial', label: 'Mode of Trial 2', type: 'codedSelect', codeKey: 'modeOfTrial' },
        { key: 'offence2Statute', label: 'Statute 2', type: 'text', cols: 2 },
        { key: 'offence3Details', label: 'Offence 3 – Details', type: 'offence', cols: 2 },
        { key: 'offence3Date', label: 'Date of Offence 3', type: 'date' },
        { key: 'offence3ModeOfTrial', label: 'Mode of Trial 3', type: 'codedSelect', codeKey: 'modeOfTrial' },
        { key: 'offence3Statute', label: 'Statute 3', type: 'text', cols: 2 },
        { key: 'offence4Details', label: 'Offence 4 – Details', type: 'offence', cols: 2 },
        { key: 'offence4Date', label: 'Date of Offence 4', type: 'date' },
        { key: 'offence4ModeOfTrial', label: 'Mode of Trial 4', type: 'codedSelect', codeKey: 'modeOfTrial' },
        { key: 'offence4Statute', label: 'Statute 4', type: 'text', cols: 2 },
        { key: 'otherOffencesNotes', label: 'Other offences (notes)', type: 'textarea', placeholder: 'List any further offences here', cols: 2 },
      ],
    },

    /* ─────── 5. DISCLOSURE ─────── */
    {
      id: 'disclosure', title: '5. Disclosure & Evidence',
      keyFields: ['oicName', 'disclosureNarrative'],
      fields: [
        { key: '_h_disclosure_received', label: 'Disclosure received', type: 'sectionHeading' },
        { key: 'disclosureType', label: 'Disclosure Type', type: 'select', options: ['Written','Oral','None'] },
        { key: 'disclosureOfficerIsOIC', label: 'Disclosure Officer is OIC?', type: 'select', options: ['Yes','No'] },
        { key: '_note_oic_same', label: 'OIC details (name, phone) already recorded in Section 1. If the disclosure officer is a different officer, complete the fields below.', type: 'sectionNote' },
        { key: 'disclosureOfficerName', label: 'Disclosure Officer Rank & Name', type: 'text', cols: 2, showIf: { field: 'disclosureOfficerIsOIC', value: 'No' } },
        { key: 'disclosureOfficerPhone', label: "Disclosure Officer's Telephone", type: 'text', showIf: { field: 'disclosureOfficerIsOIC', value: 'No' } },
        { key: 'disclosureOfficerEmail', label: "Disclosure Officer's Email", type: 'text', showIf: { field: 'disclosureOfficerIsOIC', value: 'No' } },
        { key: 'disclosureOfficerUnit', label: "Disclosure Officer's Unit", type: 'text', showIf: { field: 'disclosureOfficerIsOIC', value: 'No' } },
        { key: 'disclosureNarrative', label: 'Narrative / Disclosure Notes', type: 'textarea', cols: 2 },
        { key: 'significantStatements', label: 'Significant Statements / Silence', type: 'text', placeholder: 'e.g. None', cols: 2 },
        { key: 'clientSignedEAB', label: 'Client signed EAB?', type: 'select', options: ['Yes','No'] },
        { key: '_h_parties', label: 'Parties (conflict check first)', type: 'sectionHeading' },
        { key: 'coSuspects', label: 'Co-suspects / co-defendants?', type: 'select', options: ['Yes','No'] },
        { key: 'coSuspectDetails', label: 'Names of co-suspects / co-defendants', type: 'text', placeholder: 'e.g. John Smith, Jane Doe', cols: 2, showIf: { field: 'coSuspects', value: 'Yes' } },
        { key: 'coSuspectConflict', label: 'Conflict with co-suspect(s)?', type: 'select', options: ['Yes','No','N/A'], showIf: { field: 'coSuspects', value: 'Yes' } },
        { key: 'coSuspectConflictNotes', label: 'Conflict notes (if positive)', type: 'textarea', placeholder: 'e.g. Referred to another rep', cols: 2, showIf: { field: 'coSuspectConflict', value: 'Yes' } },
        { key: 'nameOfComplainant', label: 'Name of complainant / alleged victim (if given)', type: 'text', cols: 2 },
        { key: 'prosecutionWitnesses', label: 'Potential prosecution witnesses?', type: 'select', options: ['Yes','No'] },
        { key: 'witnessIntimidation', label: 'Witness intimidation concern?', type: 'select', options: ['Yes','No'] },
        { key: '_h_visual', label: 'Visual evidence', type: 'sectionHeading' },
        { key: 'cctvVisual', label: 'CCTV / BWV / visual evidence?', type: 'select', options: ['Yes','No'] },
        { key: 'cctvViewed', label: 'Viewed?', type: 'select', options: ['Yes','No','Not yet'], showIf: { field: 'cctvVisual', value: 'Yes' } },
        { key: 'cctvNotes', label: 'Notes (location, time, what shows)', type: 'text', cols: 2, showIf: { field: 'cctvVisual', value: 'Yes' } },
        { key: '_h_written_exhibits', label: 'Written evidence & exhibits', type: 'sectionHeading' },
        { key: 'writtenEvidence', label: 'Written evidence (MG11s, statements, docs)?', type: 'select', options: ['Yes','No'] },
        { key: 'writtenEvidenceDetails', label: 'What disclosed / notes', type: 'textarea', placeholder: 'e.g. MG11 statements, witness statements, documents', cols: 2, showIf: { field: 'writtenEvidence', value: 'Yes' } },
        { key: 'exhibitsToInspect', label: 'Exhibits / physical evidence to inspect?', type: 'select', options: ['Yes','No'] },
        { key: 'exhibitsInspected', label: 'Inspected?', type: 'select', options: ['Yes','No','Not yet','Refused','Not applicable'], showIf: { field: 'exhibitsToInspect', value: 'Yes' } },
        { key: 'exhibitsNotes', label: 'What was inspected / notes', type: 'text', placeholder: 'e.g. Knife, phone, clothing', cols: 2, showIf: { field: 'exhibitsToInspect', value: 'Yes' } },
        { key: '_h_pnc_searches', label: 'PNC & searches', type: 'sectionHeading' },
        { key: 'pncDisclosed', label: 'PNC / previous convictions disclosed?', type: 'select', options: ['Yes','No'] },
        { key: 'pncNotes', label: 'Previous convictions – details if disclosed', type: 'textarea', placeholder: 'e.g. List convictions and dates', cols: 2, showIf: { field: 'pncDisclosed', value: 'Yes' } },
        { key: '_pace_searches', label: 'PACE searches (s18, s32, s54, person, property, vehicle)', type: 'multiPaceSearch' },
        { key: '_h_forensics', label: 'Forensics & seized items', type: 'sectionHeading' },
        { key: 'samplesDisclosed', label: 'Samples (DNA, fingerprints, etc.) disclosed?', type: 'select', options: ['Yes','No','Not applicable'] },
        { key: '_forensic_samples', label: 'Forensic samples – type and what was done', type: 'multiForensicSample' },
        { key: 'clothingShoesSeized', label: 'Clothing / shoes / phone seized?', type: 'select', options: ['Yes','No'] },
        { key: '_h_other_disclosure', label: 'Other', type: 'sectionHeading' },
        { key: 'cautionAvailable', label: 'Caution / out-of-court disposal offered?', type: 'select', options: ['Yes','No'] },
        { key: 'disclosureReInjuries', label: 'Disclosure re injuries to victim', type: 'select', options: ['Not Applicable','Yes','No'] },
      ],
    },

    /* ─────── 6. CONSULTATION (Attend on Client) ─────── */
    {
      id: 'attend', title: '6. Consultation (Attend on Client)',
      keyFields: ['conflictCheckResult', 'niNumber', 'clientInstructions', 'clientDecision'],
      checklist: [
        { key: 'chkConflictCheck', label: 'Conflict of interest check completed', group: 'Conflict & independence' },
        { key: 'chkConfidentiality', label: 'Advised on Confidentiality', group: 'Conflict & independence' },
        { key: 'chkIndependence', label: 'Advised Independence of legal advice', group: 'Conflict & independence' },
        { key: 'chkFreeRep', label: 'Advised Free Representation', group: 'Conflict & independence' },
        { key: 'chkWelfare', label: 'Checked Client Welfare', group: 'Advice to client' },
        { key: 'chkDontDiscuss', label: 'Advised not to discuss case with anyone', group: 'Advice to client' },
        { key: 'chkDontSign', label: 'Advised not to sign anything without legal advice', group: 'Advice to client' },
        { key: 'chkUnderstands', label: 'Client understands advice given', group: 'Client understanding' },
        { key: 'chkPersonalData', label: 'Confirmed Personal Data on Custody Record', group: 'Custody record & disclosure' },
        { key: 'chkReasonForArrest', label: 'Explained Reason for Arrest', group: 'Custody record & disclosure' },
        { key: 'chkDisclosure', label: 'Explained Disclosure', group: 'Custody record & disclosure' },
      ],
      fields: [
        { key: '_h_conflict', label: 'Conflict Check', type: 'sectionHeading' },
        { key: '_note_conflict_mandatory', label: 'A conflict of interest check MUST be completed before advising the client. Record the result below.', type: 'sectionNote' },
        { key: 'conflictCheckResult', label: 'Conflict check result', type: 'select', options: ['Negative','Positive','N/A'] },
        { key: 'conflictCheckNotes', label: 'Conflict check notes', type: 'textarea', placeholder: 'Required if positive', cols: 2 },
        { key: '_btn_conflict_cert', label: '📄 Generate Conflict Check Certificate', type: 'actionButton', action: 'generateConflictCert' },
        { key: '_h_eligibility', label: 'Client Eligibility (from consultation)', type: 'sectionHeading' },
        { key: '_note_eligibility', label: 'Client details (name, DOB, address) from custody record are in Section 3. Complete the fields below during your consultation with the client.', type: 'sectionNote' },
        { key: 'clientType', label: 'Client Type', type: 'select', options: ['New','Existing'] },
        { key: '_h_id', label: 'Identification', type: 'sectionHeading' },
        { key: 'niNumber', label: 'National Insurance No.', type: 'text', placeholder: 'e.g. AB 12 34 56 C' },
        { key: 'arcNumber', label: 'ARC Number (if no NI)', type: 'text', placeholder: 'For non-UK nationals' },
        { key: '_h_benefits', label: 'Benefits & Income', type: 'sectionHeading' },
        { key: 'benefits', label: 'Receiving benefits?', type: 'select', options: ['Yes','No','Unknown'] },
        { key: 'benefitType', label: 'Benefit type', type: 'select', options: [
          '','Universal Credit','Universal Credit (with housing element)','Income Support','Income-based JSA (Jobseeker\'s Allowance)','Income-related ESA (Employment & Support Allowance)','Pension Credit (Guarantee Credit)','Housing Benefit','Child Tax Credit (income under £16,190)','Working Tax Credit','Personal Independence Payment (PIP)','Disability Living Allowance (DLA)','Attendance Allowance','Carer\'s Allowance','State Pension','Contribution-based JSA','Contribution-based ESA','Child Benefit','Maternity Allowance','Bereavement Support Payment','Industrial Injuries Benefit','Asylum Support (Section 95/98)','Other'
        ] },
        { key: 'benefitOther', label: 'Other benefit (specify)', type: 'text', placeholder: 'Type benefit not listed above', showIf: { field: 'benefitType', value: 'Other' } },
        { key: 'benefitNotes', label: 'Benefit notes', type: 'text' },
        { key: 'passportedBenefit', label: 'On a passporting benefit?', type: 'select', options: ['Unknown','Yes','No'] },
        { key: '_note_passported', label: 'Passporting benefits (UC, Income Support, income-based JSA/ESA, Pension Credit Guarantee) automatically pass the means test.', type: 'sectionNote' },
        { key: 'grossIncome', label: 'Gross annual income (£)', type: 'number', placeholder: 'e.g. 22000', showIf: { field: 'passportedBenefit', value: 'No' } },
        { key: 'partnerIncome', label: "Partner's gross annual income (£)", type: 'number', placeholder: 'e.g. 18000', showIf: { field: 'passportedBenefit', value: 'No' } },
        { key: 'partnerName', label: "Partner's name", type: 'text', placeholder: 'For means test / Legal Aid', showIf: { field: 'passportedBenefit', value: 'No' } },
        { key: 'incomeNotes', label: 'Income / means notes', type: 'text' },
        { key: '_h_circumstances', label: 'Personal Circumstances', type: 'sectionHeading' },
        { key: 'employmentStatus', label: 'Employment', type: 'select', options: ['Employed','Self-employed','Unemployed','Student','Retired','Other'] },
        { key: 'accommodationStatus', label: 'Accommodation', type: 'select', options: ['Owner/Occupier','Private rental (tenant)','Local Authority housing','Housing Association','Hostel / supported housing','Living with parents / family','Temporary accommodation','Homeless (rough sleeping)','NFA (no fixed abode)','Prison / custody (pre-trial)','Other'] },
        { key: 'accommodationDetails', label: 'Accommodation notes', type: 'textarea', cols: 2 },
        { key: 'maritalStatus', label: 'Marital Status', type: 'select', options: ['Single','Married/Civil Partner','Cohabiting','Divorced','Widowed','Other'] },
        { key: '_h_contact', label: 'Client Contact', type: 'sectionHeading' },
        { key: 'clientPhone', label: 'Client Telephone', type: 'tel' },
        { key: 'clientEmail', label: 'Client Email', type: 'email' },
        { key: 'clientEmailConsent', label: 'Consent to email?', type: 'select', options: ['Yes','No'] },
        { key: '_h_case_assessment', label: 'Case Assessment', type: 'sectionHeading' },
        { key: 'gapsInEvidence', label: 'Gaps in Evidence', type: 'text', placeholder: 'e.g. None', cols: 2 },
        { key: 'lawElements', label: 'The Law / Elements of offence', type: 'textarea', cols: 2 },
        { key: 'caseAssessment', label: 'Case assessment (police case)', type: 'text', placeholder: 'e.g. Strong case / Weak case', cols: 2 },
        { key: 'likelySentence', label: 'Likely sentence if convicted', type: 'text', placeholder: 'e.g. Community order', cols: 2 },
        { key: 'clientInstructions', label: 'Summary of client instructions', type: 'textarea', cols: 2 },
      ],
      adviceChecklist: [
        { key: 'advSilence', label: 'Right to Silence & Inferences Explained', group: 'Rights & caution' },
        { key: 'advCaution', label: 'Caution Explained', group: 'Rights & caution' },
        { key: 'advConsequences', label: 'Consequences of lying / different version later', group: 'Rights & caution' },
        { key: 'advBadCharacter', label: 'Bad Character', group: 'Rights & caution' },
        { key: 'advSpecialWarning', label: 'Special Warning Explained', group: 'Rights & caution' },
        { key: 'advInterviewProcedure', label: 'Interview Procedure Explained', group: 'Interview' },
        { key: 'advRights', label: 'Rights: Answer / No Answer / Prepared statement', group: 'Interview' },
        { key: 'advStopInterview', label: 'Right to Stop Interview for advice', group: 'Interview' },
        { key: 'advIDProcedures', label: 'ID procedures explained', group: 'Procedures & other' },
        { key: 'advCourtProcedure', label: 'Court procedure explained', group: 'Procedures & other' },
        { key: 'advAlibis', label: 'Alibis discussed', group: 'Procedures & other' },
        { key: 'advFailureToAttendBail', label: 'Failure to attend bail explained', group: 'Procedures & other' },
      ],
      extraFields: [
        { key: 'adviceReInterview', label: 'Advice re interview', type: 'text', placeholder: 'e.g. No comment', cols: 2 },
        { key: 'reasonsForAdviceSelect', label: 'Reason for Advice (quick select)', type: 'select', options: [
          'No comment \u2013 insufficient disclosure',
          'No comment \u2013 no disclosure / nothing provided',
          'No comment \u2013 client vulnerable / fatigued / unfit',
          'No comment \u2013 client unwell / not fit for interview',
          'No comment \u2013 complex allegations',
          'No comment \u2013 complex allegations, need full disclosure first',
          'No comment \u2013 client needs more time to consider',
          'No comment \u2013 need to take further instructions',
          'No comment \u2013 to avoid self-incrimination on other matters',
          'No comment \u2013 risk of adverse inference acceptable in circumstances',
          'No comment \u2013 client exercising right, will rely on defence at court',
          'No comment \u2013 disclosure inadequate to advise on key allegations',
          'Prepared statement \u2013 limited disclosure, account on record',
          'Prepared statement \u2013 client denies, risks of live interview',
          'Prepared statement \u2013 account on record, no comment thereafter',
          'Answer questions \u2013 strong defence, nothing to hide',
          'Answer questions \u2013 client admits, full cooperation',
          'Answer questions \u2013 client denies, early account assists defence',
          'Answer selectively \u2013 answer on key points only',
          'Answer selectively \u2013 background only, no comment on allegations',
          'Other \u2013 see notes below'
        ], cols: 2 },
        { key: 'reasonsForAdvice', label: 'Reasons for Advice (detail)', type: 'textarea', placeholder: 'Detailed reasons for the advice given', cols: 2 },
        { key: 'clientDecision', label: "Client's Decision", type: 'select', options: ['Answer questions','No comment','Prepared statement','Other'] },
        { key: 'adviceFollowedInInterview', label: 'Advice followed in interview?', type: 'select', options: ['Yes','No'] },
        { key: 'adviceFollowedExplanation', label: 'If not followed – brief explanation', type: 'textarea', placeholder: 'Required when advice was not followed', cols: 2, showIf: { field: 'adviceFollowedInInterview', value: 'No' } },
        { key: 'adviceReComplaint', label: 'Advice re making a complaint given?', type: 'select', options: ['Yes','No'] },
        { key: '_h_instructions_sigs', label: 'Confirmation of Instructions', type: 'sectionHeading' },
        { key: '_note_instructions_sigs', label: 'Rep signs to confirm the record accurately reflects the advice given and instructions received. Client signs to confirm they received this advice and these are their instructions.', type: 'sectionNote' },
        { key: 'repInstructionsSignature', label: 'Rep signature – I confirm this accurately records the advice given and the client\'s instructions', type: 'signature', sigKey: 'repInstructionsSig' },
        { key: 'clientInstructionsSignature', label: 'Client signature – I confirm this accurately records the advice I received and my instructions', type: 'signature', sigKey: 'clientInstructionsSig' },
        { key: 'instructionsSignatureDate', label: 'Signature date (auto)', type: 'date', readonly: true },
        { key: 'instructionsSignatureTime', label: 'Signature time (auto)', type: 'time', readonly: true },
        { key: '_btn_client_instructions', label: '📄 Print Client Instructions Confirmation', type: 'actionButton', action: 'generateClientInstructions' },
        { key: '_btn_prepared_statement', label: '📄 Print Prepared Statement Template', type: 'actionButton', action: 'generatePreparedStatement' },
        { key: '_h_monitoring', label: 'Monitoring', type: 'sectionHeading' },
        { key: 'ethnicOriginCode', label: 'Ethnic Origin', type: 'codedSelect', codeKey: 'ethnicCodes' },
        { key: 'disabilityCode', label: 'Disability', type: 'codedSelect', codeKey: 'disabilityCodes' },
        { key: 'riskAssessment', label: 'Risk Assessment', type: 'select', options: ['Low','Medium','High'] },
      ],
    },

    /* ─────── 7. INTERVIEW ─────── */
    {
      id: 'interview', title: '7. Interview',
      keyFields: [],
      multiInterview: true,
      interviewFields: [
        { key: 'startTime', label: 'Start Time', type: 'time' },
        { key: 'present', label: 'Those present', type: 'text', cols: 2 },
        { key: 'cautioned', label: 'Client cautioned?', type: 'select', options: ['Yes','No'] },
        { key: 'notes', label: 'Interview Notes', type: 'textarea', cols: 2 },
        { key: 'endTime', label: 'End Time', type: 'time' },
      ],
    },

    /* ─────── 8. OUTCOME ─────── */
    {
      id: 'outcome', title: '8. Outcome',
      keyFields: ['outcomeDecision'],
      fields: [
        { key: 'outcomeDecision', label: 'Decision', type: 'select', options: ['Charged without Bail','Charged with Bail','Bail without charge','Released Under Investigation','Released NFA','Simple Caution','Conditional Caution','Community Resolution','Penalty Notice (PND)','Remanded in Custody','Handed back to DSCC','Did not attend (exceptional circumstances)','Other'], cols: 2 },
        { key: 'handedBackToDSCCReason', label: 'Reason handed back to DSCC', type: 'textarea', placeholder: 'Required per Spec 9.53', cols: 2, showIf: { field: 'outcomeDecision', value: 'Handed back to DSCC' } },
        { key: 'nonAttendanceReason', label: 'Reason for non-attendance (exceptional circumstances)', type: 'textarea', placeholder: 'Required per Spec 9.39/9.44', cols: 2, showIf: { field: 'outcomeDecision', value: 'Did not attend (exceptional circumstances)' } },
        { key: '_h_bail_return', label: 'Bail to return details', type: 'sectionHeading', showIf: { field: 'outcomeDecision', value: 'Bail without charge' } },
        { key: 'bailDate', label: 'Date to return', type: 'date', showIf: { field: 'outcomeDecision', values: ['Charged with Bail','Bail without charge'] } },
        { key: 'bailReturnTime', label: 'Time to return', type: 'time', showIf: { field: 'outcomeDecision', value: 'Bail without charge' } },
        { key: 'bailReturnStationName', label: 'Police station to return to (name)', type: 'text', placeholder: 'Same as attendance if unchanged', cols: 2, showIf: { field: 'outcomeDecision', value: 'Bail without charge' } },
        { key: 'bailReturnStationCode', label: 'Police station to return to (code)', type: 'text', placeholder: 'Scheme ID / station code', showIf: { field: 'outcomeDecision', value: 'Bail without charge' } },
        { key: 'bailType', label: 'Bail type', type: 'select', options: ['Unconditional','Conditional'], showIf: { field: 'outcomeDecision', values: ['Charged with Bail','Bail without charge'] } },
        { key: '_bailConditions', label: 'Bail conditions', type: 'bailConditions', cols: 2, showIf: { field: 'bailType', value: 'Conditional' } },
        { key: 'outcomeOffence1Details', label: 'Charge 1 – Details', type: 'text', cols: 2, showIf: { field: 'outcomeDecision', values: ['Charged without Bail','Charged with Bail','Remanded in Custody'] } },
        { key: 'outcomeOffence1Statute', label: 'Charge 1 – Statute', type: 'text', cols: 2, showIf: { field: 'outcomeDecision', values: ['Charged without Bail','Charged with Bail','Remanded in Custody'] } },
        { key: 'outcomeOffence2Details', label: 'Charge 2 – Details', type: 'text', cols: 2, showIf: { field: 'outcomeDecision', values: ['Charged without Bail','Charged with Bail','Remanded in Custody'] } },
        { key: 'outcomeOffence2Statute', label: 'Charge 2 – Statute', type: 'text', cols: 2, showIf: { field: 'outcomeDecision', values: ['Charged without Bail','Charged with Bail','Remanded in Custody'] } },
        { key: 'outcomeOffence3Details', label: 'Charge 3 – Details', type: 'text', cols: 2, showIf: { field: 'outcomeDecision', values: ['Charged without Bail','Charged with Bail','Remanded in Custody'] } },
        { key: 'outcomeOffence3Statute', label: 'Charge 3 – Statute', type: 'text', cols: 2, showIf: { field: 'outcomeDecision', values: ['Charged without Bail','Charged with Bail','Remanded in Custody'] } },
        { key: 'outcomeOffence4Details', label: 'Charge 4 – Details', type: 'text', cols: 2, showIf: { field: 'outcomeDecision', values: ['Charged without Bail','Charged with Bail','Remanded in Custody'] } },
        { key: 'outcomeOffence4Statute', label: 'Charge 4 – Statute', type: 'text', cols: 2, showIf: { field: 'outcomeDecision', values: ['Charged without Bail','Charged with Bail','Remanded in Custody'] } },
        { key: 'bailDate', label: 'Bail / Return Date', type: 'date', showIf: { field: 'outcomeDecision', value: 'Released Under Investigation' } },
        { key: 'courtName', label: 'Court Name', type: 'text', showIf: { field: 'outcomeDecision', values: ['Charged without Bail','Charged with Bail','Remanded in Custody'] } },
        { key: 'courtDate', label: 'Court Date', type: 'date', showIf: { field: 'outcomeDecision', values: ['Charged without Bail','Charged with Bail','Remanded in Custody'] } },
        { key: 'nextLocationName', label: 'Next Location', type: 'text' },
        { key: 'nextDate', label: 'Next Date', type: 'date' },
        { key: 'furtherAttendance', label: 'Further attendance needed?', type: 'select', options: ['Yes','No'] },
      ],
    },

    /* ─────── 9. TIME RECORDING & FEES ─────── */
    {
      id: 'timeRecording', title: '9. Time Recording & Fees',
      keyFields: ['totalMinutes'],
      fields: [
        { key: '_h_departure', label: 'Departure & Return', type: 'sectionHeading' },
        { key: 'timeDeparture', label: 'Time of departure from station', type: 'time' },
        { key: 'timeOfficeHome', label: 'Time of arrival office / home', type: 'time' },
        { key: 'multipleJourneys', label: 'Multiple journeys?', type: 'select', options: ['Yes','No'] },
        { key: '_h_waiting', label: 'Waiting Time', type: 'sectionHeading' },
        { key: 'waitingTimeStart', label: 'Waiting time start', type: 'time' },
        { key: 'waitingTimeEnd', label: 'Waiting time end', type: 'time' },
        { key: 'waitingTimeNotes', label: 'Waiting time notes', type: 'textarea', placeholder: 'Optional notes', cols: 2 },
        { key: '_heading_breakdown', label: 'Calculated breakdown', type: 'sectionHeading' },
        { key: '_note_6min', label: 'LAA times are recorded in 6-minute (0.1 hour) units.', type: 'sectionNote' },
        { key: 'travelSocial', label: 'Travel – social (mins)', type: 'number', readonly: true, className: 'journey-auto-field' },
        { key: 'travelUnsocial', label: 'Travel – unsocial (mins)', type: 'number', readonly: true, className: 'journey-auto-field' },
        { key: 'waitingSocial', label: 'Waiting – social (mins)', type: 'number', readonly: true, className: 'journey-auto-field' },
        { key: 'waitingUnsocial', label: 'Waiting – unsocial (mins)', type: 'number', readonly: true, className: 'journey-auto-field' },
        { key: 'adviceSocial', label: 'Attendance & Advice – social (mins)', type: 'number', readonly: true },
        { key: 'adviceUnsocial', label: 'Attendance & Advice – unsocial (mins)', type: 'number', readonly: true },
        { key: 'totalMinutes', label: 'Total minutes (all work)', type: 'number', readonly: true },
        { key: '_heading_costs', label: 'Costs', type: 'sectionHeading' },
        { key: 'milesClaimable', label: 'Miles claimable (45p)', type: 'number' },
        { key: 'parkingCost', label: 'Parking cost (\u00a3)', type: 'number', placeholder: '0.00' },
        { key: '_disbursements', label: 'Disbursements', type: 'multiDisbursement' },
        { key: '_h_case_stage', label: 'Case Stage', type: 'sectionHeading' },
        { key: 'numSuspects', label: 'Number of suspects', type: 'number', placeholder: 'e.g. 1', firmCompletes: true },
        { key: 'numAttendances', label: 'No. of police station attendances', type: 'number', placeholder: 'e.g. 1' },
        { key: 'caseStage', label: 'Case Stage', type: 'select', options: ['New case','Retained','Continued','Case concluded','Finalised'] },
        { key: 'policeStationFinalisedDate', label: 'Date police station finalised', type: 'date' },
        { key: 'policeStationFinalisedTime', label: 'Time police station finalised', type: 'time' },
        { key: 'repConfirmationSignature', label: 'Rep confirmation (signature)', type: 'signature', sigKey: 'repConfirmationSig' },
        { key: 'notesToOffice', label: 'Notes to Office / Firm', type: 'textarea', cols: 2 },
        { key: '_h_invoice', label: 'Invoice', type: 'sectionHeading' },
        { key: 'invoiceSent', label: 'Invoice sent?', type: 'select', options: ['No','Yes'] },
        { key: 'invoiceSentDate', label: 'Date sent', type: 'date', readonly: true, showIf: { field: 'invoiceSent', value: 'Yes' } },
        { key: 'invoiceSentTime', label: 'Time sent', type: 'time', readonly: true, showIf: { field: 'invoiceSent', value: 'Yes' } },
        { key: 'invoiceNotes', label: 'Invoice notes', type: 'text', placeholder: 'e.g. Sent via CWA portal', cols: 2 },
      ],
    },
  ];

  /* Stand-alone options (opened from first page / home): Consents, Third Party, Authorities, Comms, Supervisor, LAA Declaration, Admin & Billing last */
  const standaloneSections = [
    { id: 'videoCaptureStandalone', title: 'Video Capture', keyFields: ['vidCapRecordingType', 'vidCapMediaRef'], fields: [
      { key: '_h_vidcap', label: 'Video Capture (PACE Code E / F)', type: 'sectionHeading' },
      { key: '_note_vidcap', label: 'Use this section to record the key details needed to evidence that interview recording was carried out correctly (PACE Code E: audio recording; PACE Code F: visual recording with sound) and to capture continuity/media reference information for the file.', type: 'sectionNote' },

      { key: 'vidCapRecordingType', label: 'Recording type', type: 'select', options: ['Audio only (PACE Code E)','Visual + sound (PACE Code F)','BWV / body-worn video','Other'] },
      { key: 'vidCapRecordingTypeOther', label: 'Other recording type (specify)', type: 'text', cols: 2, showIf: { field: 'vidCapRecordingType', value: 'Other' } },

      { key: '_h_vidcap_times', label: 'Times & location', type: 'sectionHeading' },
      { key: 'vidCapStartTime', label: 'Recording / interview start time', type: 'time' },
      { key: 'vidCapEndTime', label: 'Recording / interview end time', type: 'time' },
      { key: 'vidCapLocation', label: 'Location', type: 'text', placeholder: 'e.g. Custody suite / station name', cols: 2 },
      { key: 'vidCapRoom', label: 'Room / interview room', type: 'text', placeholder: 'e.g. Interview room 2', cols: 2 },
      { key: 'vidCapBreaks', label: 'Breaks / interruptions (times + reason)', type: 'textarea', cols: 2, placeholder: 'Record any pauses, breaks, or interruptions (and why).' },

      { key: '_h_vidcap_people', label: 'People present', type: 'sectionHeading' },
      { key: 'vidCapInterviewingOfficers', label: 'Interviewing officer(s) (rank & name)', type: 'textarea', cols: 2, placeholder: 'Include all officers conducting the interview.' },
      { key: 'vidCapOthersPresent', label: 'Others present (e.g. interpreter, AA)', type: 'textarea', cols: 2 },

      { key: '_h_vidcap_media', label: 'Media reference & continuity', type: 'sectionHeading' },
      { key: 'vidCapMediaRef', label: 'Unique reference (URN / disc / file ref)', type: 'text', placeholder: 'The identifier you will request/retain for disclosure', cols: 2 },
      { key: 'vidCapMasterWorkingCopy', label: 'Master / working copy process noted?', type: 'select', options: ['Yes','No','Unknown'] },
      { key: 'vidCapExhibitRef', label: 'Exhibit reference (if allocated)', type: 'text', cols: 2 },
      { key: 'vidCapSealedBy', label: 'Sealed by (rank & name)', type: 'text', cols: 2 },
      { key: 'vidCapSealedTime', label: 'Time sealed', type: 'time' },
      { key: 'vidCapContinuityNotes', label: 'Continuity notes', type: 'textarea', cols: 2, placeholder: 'Any chain of custody / sealing / storage notes relevant to continuity.' },

      { key: '_h_vidcap_issues', label: 'Issues & defence copy', type: 'sectionHeading' },
      { key: 'vidCapMalfunction', label: 'Malfunction / failure to record?', type: 'select', options: ['No','Yes','Unknown'] },
      { key: 'vidCapMalfunctionNotes', label: 'Malfunction / remedy details', type: 'textarea', cols: 2, showIf: { field: 'vidCapMalfunction', value: 'Yes' }, placeholder: 'Describe what failed and what was done (restart, written record, etc.).' },
      { key: 'vidCapDefenceCopyRequested', label: 'Defence copy requested?', type: 'select', options: ['Yes','No','N/A'] },
      { key: 'vidCapDefenceCopyRequestedDate', label: 'Date copy requested', type: 'date', showIf: { field: 'vidCapDefenceCopyRequested', value: 'Yes' } },
      { key: 'vidCapDefenceCopyProvidedDate', label: 'Date copy provided (if known)', type: 'date', showIf: { field: 'vidCapDefenceCopyRequested', value: 'Yes' } },
      { key: 'vidCapDefenceCopyNotes', label: 'Defence copy notes', type: 'textarea', cols: 2, showIf: { field: 'vidCapDefenceCopyRequested', value: 'Yes' }, placeholder: 'Any notes re refusal/delay, format, method, etc.' },

      { key: '_h_vidcap_notes', label: 'Notes', type: 'sectionHeading' },
      { key: 'vidCapNotes', label: 'Additional notes', type: 'textarea', cols: 2 },
    ]},

    { id: 'videoIdParadeStandalone', title: 'Video Identification Parade', keyFields: ['vidParadeType', 'vidParadeResult'], fields: [
      { key: '_h_vidparade', label: 'Video Identification Parade (PACE Code D / VIPER)', type: 'sectionHeading' },
      { key: '_note_vidparade', label: 'Use this section to record the key details of an identification procedure (e.g. VIPER) including type, who conducted it, solicitor presence, any objections, and result. Record any procedural concerns for the file.', type: 'sectionNote' },

      { key: 'vidParadeType', label: 'Parade type', type: 'select', options: ['VIPER (video)','Live parade','Group identification','Confrontation','Other'] },
      { key: 'vidParadeTypeOther', label: 'Other type (specify)', type: 'text', cols: 2, showIf: { field: 'vidParadeType', value: 'Other' } },
      { key: 'vidParadeDate', label: 'Date', type: 'date' },
      { key: 'vidParadeTime', label: 'Time', type: 'time' },
      { key: 'vidParadeLocation', label: 'Location', type: 'text', cols: 2, placeholder: 'e.g. station / suite / location' },
      { key: 'vidParadeConductingOfficer', label: 'Conducting officer (rank & name)', type: 'text', cols: 2 },

      { key: '_h_vidparade_detail', label: 'Procedure details', type: 'sectionHeading' },
      { key: 'vidParadeClientPosition', label: 'Suspect/client position (if known)', type: 'text', placeholder: 'e.g. 3 of 9', cols: 2 },
      { key: 'vidParadeFoilsCount', label: 'Number of foils (if known)', type: 'number', placeholder: 'e.g. 8' },
      { key: 'vidParadeSolicitorPresent', label: 'Solicitor / rep present throughout?', type: 'select', options: ['Yes','No','Partially','Unknown'] },
      { key: 'vidParadeObjections', label: 'Objections / procedural concerns', type: 'textarea', cols: 2, placeholder: 'Record any objections or concerns (Code D compliance).' },
      { key: 'vidParadeResult', label: 'Result', type: 'select', options: ['Identified','Not identified','Not completed','Not applicable / N/A'] },
      { key: 'vidParadeNotes', label: 'Notes', type: 'textarea', cols: 2 },
    ]},

    { id: 'consents', title: 'Consents & Retainer', keyFields: ['retainerClientName'], fields: [
      { key: '_h_consent', label: 'Client Authority / Consent', type: 'sectionHeading' },
      { key: '_note_consent', label: 'I consent to the appointed firm acting for me in this matter; to communicate with the police, court, and other parties as necessary on my behalf; to instruct experts and obtain evidence where needed; and to accept and comply with Legal Aid funding (where applicable). I confirm that the information I have provided is accurate and that I have read and understood the terms of the retainer.', type: 'sectionNote' },
      { key: 'clientAuthorityConfirmed', label: 'Authority to act confirmed?', type: 'select', options: ['Yes','No','To be obtained'] },
      { key: 'authorityMethod', label: 'Method of authority', type: 'select', options: ['In person','Telephone','Written','Other'] },
      { key: 'authorityDateGiven', label: 'Date authority given', type: 'date' },
      { key: 'authorityTimeGiven', label: 'Time authority given', type: 'time' },
      { key: 'authorityConfirmedBy', label: 'Authority confirmed by (name/role)', type: 'text', cols: 2 },
      { key: 'authorityLimitations', label: 'Any limitations or conditions', type: 'textarea', cols: 2 },
      { key: 'clientCapacityConfirmed', label: 'Client capacity confirmed?', type: 'select', options: ['Yes','No','N/A'] },
      { key: 'interpreterUsedForAuthority', label: 'Interpreter used for authority?', type: 'select', options: ['Yes','No'] },
      { key: '_h_retainer', label: 'Retainer Details', type: 'sectionHeading' },
      { key: 'retainerType', label: 'Retainer type', type: 'select', options: ['Legal Aid','Private','Other'] },
      { key: 'legalAidApplicationDate', label: 'Legal Aid application date (if applicable)', type: 'date', showIf: { field: 'retainerType', value: 'Legal Aid' } },
      { key: 'retainerUfnMaat', label: 'UFN / MAAT (when available)', type: 'text', placeholder: 'e.g. UFN or MAAT reference' },
      { key: 'retainerClientName', label: 'Client name', type: 'text', cols: 2 },
      { key: 'retainerDob', label: 'Date of Birth', type: 'date' },
      { key: 'retainerAddress', label: 'Client address', type: 'textarea', cols: 2 },
      { key: 'retainerSolicitorName', label: 'Appointed solicitor / firm', type: 'text', cols: 2 },
      { key: 'retainerSolicitorAddress', label: 'Solicitor address', type: 'textarea', cols: 2 },
      { key: 'retainerDate', label: 'Date', type: 'date' },
      { key: 'retainerSigned', label: 'Retainer signed?', type: 'select', options: ['Yes','No','To follow'] },
      { key: 'retainerCopyOnFile', label: 'Copy on file?', type: 'select', options: ['Yes','No'] },
    ], extraActions: true },
    { id: 'thirdPartyAuth', title: 'Third Party Authority', keyFields: [], fields: [
      { key: '_h_tp_intro', label: 'Third Party Authority', type: 'sectionHeading' },
      { key: '_note_tp', label: 'Record authority from the client to contact a third party, disclose information, and capture their details.', type: 'sectionNote' },
      { key: '_thirdPartyEntries', label: 'Third party contacts', type: 'multiThirdParty' },
    ]},
    { id: 'appointedAuth', title: 'Authorities', keyFields: ['appointedSolicitorName'], fields: [
      { key: '_h_appointed_sol', label: 'Appointed Solicitor', type: 'sectionHeading' },
      { key: 'appointedSolicitorName', label: 'Solicitor / Firm Name', type: 'text', cols: 2 },
      { key: 'appointedSolicitorRef', label: 'Reference', type: 'text' },
      { key: 'appointedSolicitorPhone', label: 'Telephone', type: 'tel' },
      { key: 'appointedSolicitorEmail', label: 'Email', type: 'email' },
      { key: 'appointedSolicitorAddress', label: 'Address', type: 'textarea', cols: 2 },
      { key: 'appointedSolicitorAuthDate', label: 'Date authority given', type: 'date' },
      { key: 'appointedSolicitorNotes', label: 'Notes', type: 'textarea', cols: 2 },
      { key: '_h_medical_auth', label: 'Medical Authorities', type: 'sectionHeading' },
      { key: '_note_medical', label: 'Record authority to obtain medical records or contact medical professionals. Add a separate entry for each provider (GP, hospital, mental health team, etc.).', type: 'sectionNote' },
      { key: '_medicalAuthEntries', label: 'Medical authorities', type: 'multiMedicalAuth' },
      { key: '_h_other_auth', label: 'Other Professional Authority', type: 'sectionHeading' },
      { key: '_note_other_auth', label: 'Record any other authority not covered above (e.g. social services, housing authority, education records).', type: 'sectionNote' },
      { key: '_otherAuthEntries', label: 'Other authorities', type: 'multiOtherAuth' },
    ]},
    { id: 'commsLog', title: 'Communications Log', keyFields: [], fields: [
      { key: '_h_comms', label: 'Communications Log', type: 'sectionHeading' },
      { key: '_note_comms', label: 'Log telephone calls, emails, and text messages. Each entry records the type, direction, party, and summary.', type: 'sectionNote' },
      { key: '_commsLogEntries', label: 'Communications', type: 'multiCommsLog' },
    ]},
    { id: 'supervisorReview', title: 'Supervisor Review', keyFields: ['supervisorName'], fields: [
      { key: '_h_supervisor', label: 'Supervisor Review', type: 'sectionHeading' },
      { key: 'supervisorName', label: 'Supervising Solicitor / Manager', type: 'text', cols: 2 },
      { key: 'supervisorComments', label: 'Supervisor Comments', type: 'textarea', cols: 2, rows: 4 },
      { key: 'supervisorDate', label: 'Date of Review (auto)', type: 'date', readonly: true },
      { key: 'supervisorTime', label: 'Time of Review (auto)', type: 'time', readonly: true },
      { key: 'supervisorSignature', label: 'Supervisor Signature', type: 'signature', sigKey: 'supervisorSig' },
    ]},
    { id: 'laaDeclaration', title: 'LAA Declaration', keyFields: ['laaClientFullName', 'clientSig'], hasDeclarationText: true, fields: [
      { key: 'previousAdvice', label: 'Has client received advice on this matter before?', type: 'select', options: ['Yes','No'] },
      { key: 'previousAdviceDetails', label: 'Previous advice details', type: 'text', cols: 2, showIf: { field: 'previousAdvice', value: 'Yes' } },
      { key: 'privacyNoticeAccepted', label: 'Privacy Notice acknowledged?', type: 'select', options: ['Yes','No'] },
      { key: 'clientSignature', label: 'Client Signature (Applicant)', type: 'signature', sigKey: 'clientSig' },
      { key: 'laaClientFullName', label: 'Client Full Name (BLOCK CAPITALS)', type: 'text', cols: 2 },
      { key: 'laaSignatureDate', label: 'Date of Signature (auto)', type: 'date', readonly: true },
      { key: 'laaSignatureTime', label: 'Time of Signature (auto)', type: 'time', readonly: true },
      { key: 'feeEarnerSignature', label: 'Fee Earner Signature', type: 'signature', sigKey: 'feeEarnerSig' },
      { key: 'laaFeeEarnerFullName', label: 'Fee Earner Full Name', type: 'text', placeholder: 'Your full name', cols: 2 },
      { key: 'feeEarnerCertification', label: 'Certification', type: 'select', options: ['Draft','Finalised'] },
    ]},
    { id: 'adminBilling', title: 'Admin & Billing', keyFields: ['ourFileNumber', 'ufn'], fields: [
      { key: '_h_admin', label: 'Administration', type: 'sectionHeading' },
      { key: 'ourFileNumber', label: 'File number (ours) / Invoice number', type: 'text', placeholder: 'Type invoice number', cols: 2 },
      { key: 'ufn', label: 'UFN (Unique File Number)', type: 'text', placeholder: 'Firm provides this', cols: 2, firmCompletes: true },
      { key: 'firmLaaAccount', label: 'Firm LAA Account No.', type: 'text', placeholder: 'Firm provides this', firmCompletes: true },
      { key: 'maatId', label: 'MAAT ID', type: 'text', placeholder: 'Firm provides after charge', firmCompletes: true },
    ]},
    { id: 'crm14', title: 'Legal Aid application (Apply / CRM14)', keyFields: ['crm14CaseType', 'crm14MaatRef'], fields: [
      { key: '_note_crm14', label: 'Apply for criminal legal aid: The LAA\'s mandatory route is the Apply for criminal legal aid service (apply-for-criminal-legal-aid.service.justice.gov.uk). This section captures the same information required for that application. The paper CRM14/CRM15 forms are only used in limited circumstances (e.g. no portal access, civil contempt, breach of civil injunction). Complete this section to support either route.', type: 'sectionNote' },
      { key: '_note_crm14_retain', label: 'The Apply service produces an online form signed by the client (typically 2 pages). You must retain a copy of this signed form on the client file.', type: 'sectionNote' },
      { key: 'crm14SignedFormOnFile', label: 'Signed Apply application (client-signed, 2-page) on file?', type: 'select', options: ['Yes','No','To follow','N/A (paper CRM14 used)'] },
      { key: '_h_crm14_about', label: 'About you – Personal details', type: 'sectionHeading' },
      { key: 'crm14NewOrChange', label: 'New application or change of circumstances?', type: 'select', options: ['New application','Change of circumstances'] },
      { key: 'crm14Title', label: 'Title', type: 'select', options: ['Mr','Mrs','Miss','Ms','Mx','Other'] },
      { key: 'crm14Forename', label: 'First name(s)', type: 'text', cols: 2, placeholder: 'Or use main form name' },
      { key: 'crm14Surname', label: 'Surname', type: 'text', cols: 2 },
      { key: 'crm14Dob', label: 'Date of birth', type: 'date' },
      { key: 'crm14NiNumber', label: 'National Insurance number', type: 'text', placeholder: 'Or ARC number if no NI' },
      { key: 'crm14ArcNumber', label: 'Application Registration Card (ARC) number', type: 'text', placeholder: 'If no NI number' },
      { key: '_h_crm14_contact', label: 'About you – Contact information', type: 'sectionHeading' },
      { key: 'crm14HomeAddress', label: 'Usual home address', type: 'textarea', cols: 2, placeholder: 'Or use main form address' },
      { key: 'crm14CorrespondenceAddress', label: 'Correspondence address (if different from home)', type: 'textarea', cols: 2 },
      { key: 'crm14Email', label: 'Email address', type: 'email' },
      { key: 'crm14Landline', label: 'Landline telephone', type: 'tel' },
      { key: 'crm14Mobile', label: 'Mobile telephone', type: 'tel' },
      { key: 'crm14WorkPhone', label: 'Work telephone', type: 'tel' },
      { key: '_h_crm14_case', label: 'About you – Case details', type: 'sectionHeading' },
      { key: 'crm14CaseType', label: 'Case type', type: 'select', options: ['Summary','Either way','Indictable','Appeal','Committal for sentence'] },
      { key: 'crm14CourtName', label: 'Court name', type: 'text', cols: 2 },
      { key: 'crm14CourtHearingDate', label: 'Court hearing date', type: 'date' },
      { key: 'crm14MaatRef', label: 'MAAT reference number', type: 'text', cols: 2 },
      { key: 'crm14Urn', label: 'URN (Unique Reference Number)', type: 'text', cols: 2 },
      { key: 'crm14AppealLodgedDate', label: 'Appeal lodged date (if applicable)', type: 'date' },
      { key: '_h_crm14_housing', label: 'Housing and personal circumstances', type: 'sectionHeading' },
      { key: 'crm14HousingType', label: 'Housing status', type: 'select', options: ['Owned','Private tenancy','Local Authority','Housing Association','Living with parents/family','Temporary accommodation','Homeless','NFA (no fixed abode)','Other'] },
      { key: 'crm14Under18', label: 'Applicant under 18?', type: 'select', options: ['Yes','No'] },
      { key: '_h_crm14_partner', label: 'Partner details', type: 'sectionHeading' },
      { key: 'crm14HasPartner', label: 'Do you have a partner?', type: 'select', options: ['Yes','No'] },
      { key: 'crm14PartnerName', label: "Partner's full name", type: 'text', cols: 2, showIf: { field: 'crm14HasPartner', value: 'Yes' } },
      { key: 'crm14PartnerDob', label: "Partner's date of birth", type: 'date', showIf: { field: 'crm14HasPartner', value: 'Yes' } },
      { key: 'crm14PartnerRelationship', label: 'Relationship to partner', type: 'select', options: ['Married','Civil partnership','Cohabiting'], showIf: { field: 'crm14HasPartner', value: 'Yes' } },
      { key: 'crm14PartnerAddress', label: "Partner's address (if different from yours)", type: 'textarea', cols: 2, showIf: { field: 'crm14HasPartner', value: 'Yes' } },
      { key: 'crm14PartnerVictimWitnessCoDef', label: 'Is your partner a victim, prosecution witness, or co-defendant in this case?', type: 'select', options: ['Yes','No','N/A'], showIf: { field: 'crm14HasPartner', value: 'Yes' } },
      { key: '_h_crm14_financial', label: 'Financial assessment', type: 'sectionHeading' },
      { key: 'crm14PassportingBenefits', label: 'Do you or your partner receive any of these? (Income-Related ESA, JSA, Guarantee State Pension Credit)', type: 'select', options: ['Yes – Income-Related ESA','Yes – Income-Based JSA','Yes – Guarantee State Pension Credit','Yes – Universal Credit (passported)','No'] },
      { key: 'crm14IncomeOverThreshold', label: 'Is your total household income over £12,475 per year (£239.90 per week)?', type: 'select', options: ['Yes','No','Passported (automatic)'] },
      { key: 'crm14IncomeSources', label: 'Income sources (employment, self-employment, child benefit, etc.)', type: 'textarea', cols: 2, placeholder: 'Brief details; complete CRM15 if over threshold' },
      { key: 'crm14Crm15Required', label: 'CRM15 financial statement required?', type: 'select', options: ['Yes','No','Completed'] },
      { key: '_h_crm14_ioj', label: 'Interests of Justice', type: 'sectionHeading' },
      { key: 'crm14InterestsOfJustice', label: 'Interests of Justice test – outcome and notes', type: 'textarea', cols: 2 },
    ]},
  ];

  /* ═══════════════════════════════════════════════════════════════
     TELEPHONE ADVICE SECTIONS – INVB (telephone advice only) claim
     7 purpose-built sections for LAA-compliant telephone advice.
     ═══════════════════════════════════════════════════════════════ */
  const telFormSections = [
    /* ─────── T1. CALL DETAILS ─────── */
    {
      id: 'telCallDetails', title: '1. Call Details',
      keyFields: ['date', 'policeStationId', 'dsccRef', 'matterTypeCode', 'feeCode'],
      fields: [
        { key: 'ourFileNumber', label: 'File number (ours) / Invoice number', type: 'text', placeholder: 'Type invoice number (auto-assigned on create if left blank)' },
        { key: 'instructionDateTime', label: 'Date & time instruction received', type: 'datetime-local' },
        { key: 'date', label: 'Date of telephone advice', type: 'date' },
        { key: 'sourceOfReferral', label: 'Source of Referral', type: 'select', options: ['Duty Rota','Duty panel','Own Legal Aid','Own private','Agency'] },
        { key: 'dsccRef', label: 'DSCC Number', type: 'text', placeholder: 'e.g. 110154321A', className: 'field-mandatory' },
        { key: 'policeStationId', label: 'Police Station', type: 'station', cols: 2 },
        { key: 'firmId', label: 'Instructing Firm', type: 'firm', cols: 2 },
        { key: 'feeEarnerName', label: 'Fee Earner Name', type: 'text', placeholder: 'Name of person giving advice', cols: 2 },
        { key: 'dutySolicitor', label: 'Duty Solicitor?', type: 'select', options: ['Yes','No'] },
        { key: 'notCddMatter', label: 'Not a CDD matter?', type: 'select', options: ['Confirmed \u2013 not CDD','CDD declined \u2013 see reason','CDD unable to provide advice'] },
        { key: 'cddDeclinedReason', label: 'CDD reason / details', type: 'textarea', placeholder: 'Why CDD did not handle this matter', cols: 2, showIf: { field: 'notCddMatter', values: ['CDD declined \u2013 see reason','CDD unable to provide advice'] } },
        { key: '_h_offence', label: 'Offence', type: 'sectionHeading' },
        { key: 'matterTypeCode', label: 'Matter Type', type: 'codedSelect', codeKey: 'matterTypeCodes', cols: 2 },
        { key: 'offenceSummary', label: 'Offence (summary)', type: 'text', placeholder: 'e.g. Theft, Assault', cols: 2 },
        { key: '_h_claim', label: 'Claim', type: 'sectionHeading' },
        { key: 'feeCode', label: 'Fee Code (SaBC)', type: 'select', options: ['INVB1 – London','INVB2 – Outside London'], className: 'field-mandatory' },
      ],
    },

    /* ─────── T2. CLIENT & ADVICE ─────── */
    {
      id: 'telClientAdvice', title: '2. Client & Advice',
      keyFields: ['surname', 'telephoneAdviceSummary', 'clientDecision'],
      fields: [
        { type: 'nameRow', label: 'Client Name', fields: [
            { key: 'forename', label: 'First name', placeholder: 'First name' },
            { key: 'surname', label: 'Surname', placeholder: 'Surname' }
          ], cols: 2 },
        { key: 'dob', label: 'Date of Birth', type: 'date' },
        { key: 'gender', label: 'Gender', type: 'select', options: ['Male','Female','Other','Prefer not to say'] },
        { key: 'clientPhone', label: 'Client Telephone', type: 'tel', placeholder: 'Essential for telephone advice', className: 'field-mandatory' },
        { key: '_h_contact_timing', label: 'First Contact', type: 'sectionHeading' },
        { key: 'timeFirstContactWithClient', label: 'Time of first contact with client', type: 'time' },
        { key: 'firstContactWithin45Mins', label: 'First contact within 45 mins?', type: 'select', options: ['Yes','No'] },
        { key: 'firstContactOver45MinsReason', label: 'Reason >45 mins', type: 'textarea', placeholder: 'Required if first contact exceeded 45 mins', cols: 2, showIf: { field: 'firstContactWithin45Mins', value: 'No' } },
        { key: 'conflictCheckResult', label: 'Conflict check', type: 'select', options: ['Negative','Positive','N/A'] },
        { key: 'conflictCheckNotes', label: 'Conflict notes', type: 'textarea', placeholder: 'Required if positive', cols: 2, showIf: { field: 'conflictCheckResult', value: 'Positive' } },
        { key: '_h_advice', label: 'Advice', type: 'sectionHeading' },
        { key: 'telephoneAdviceSummary', label: 'Summary of advice given', type: 'textarea', placeholder: 'Detailed summary of the advice provided to the client during the call(s)', cols: 2 },
        { key: 'clientDecision', label: "Client's Decision", type: 'select', options: ['Answer questions','No comment','Prepared statement','Accept caution','N/A \u2013 no interview','Other'] },
      ],
    },

    /* ─────── T3. OUTCOME ─────── */
    {
      id: 'telOutcome', title: '3. Outcome',
      keyFields: ['outcomeDecision', 'outcomeCode', 'caseConcludedDate'],
      fields: [
        { key: 'outcomeDecision', label: 'Outcome', type: 'select', options: [
          'NFA \u2013 no further action',
          'Simple Caution',
          'Conditional Caution',
          'Community Resolution',
          'Penalty Notice (PND)',
          'Charged',
          'Released Under Investigation',
          'Released on pre-charge bail',
          'Handed back to DSCC',
          'Further call arranged',
          'Attendance now required',
          'Other'
        ], cols: 2 },
        { key: '_note_convert', label: 'If attendance is now required, use the button below. Per Spec 9.74, you must not claim both INVB and INVC for the same matter.', type: 'sectionNote', showIf: { field: 'outcomeDecision', value: 'Attendance now required' } },
        { key: '_btn_convert', label: 'Convert to Attendance Note', type: 'actionButton', action: 'convertToAttendance', showIf: { field: 'outcomeDecision', value: 'Attendance now required' } },
        { key: 'outcomeCode', label: 'Outcome Code', type: 'select', options: [
          'CN01 \u2013 No further instructions',
          'CN02 \u2013 Change of solicitor',
          'CN03 \u2013 Client not a suspect',
          'CN04 \u2013 No further action',
          'CN05 \u2013 Simple caution / reprimand / warning',
          'CN06 \u2013 Charge / Summons',
          'CN07 \u2013 Conditional Caution',
          'CN08 \u2013 Fixed Penalty Notice',
          'CN09 \u2013 Released no bail',
          'CN10 \u2013 Bail varied / extended',
          'CN11 \u2013 Bail not varied / extended',
          'CN12 \u2013 Pre-Charge Engagement agreed',
          'CN13 \u2013 Pre-Charge Engagement not agreed'
        ], cols: 2 },
        { key: 'furtherAttendance', label: 'Further attendance likely?', type: 'select', options: ['Yes','No'] },
        { key: '_note_spec974', label: 'Spec 9.74: If telephone advice is followed by attendance, claim INVC only (not both INVB + INVC).', type: 'sectionNote', showIf: { field: 'furtherAttendance', value: 'Yes' } },
        { key: 'caseConcludedDate', label: 'Case concluded date', type: 'date', className: 'field-mandatory' },
      ],
    },

    /* ─────── T4. SIGN OFF ─────── */
    {
      id: 'telSignOff', title: '4. Sign Off',
      keyFields: ['laaClientFullName', 'clientSig'],
      hasDeclarationText: true,
      fields: [
        { key: '_h_time', label: 'Time & Counts', type: 'sectionHeading' },
        { key: 'telephoneCallDuration', label: 'Total call duration (minutes)', type: 'number', placeholder: 'e.g. 25' },
        { key: 'numberOfCalls', label: 'Number of calls', type: 'number', placeholder: 'e.g. 3' },
        { key: 'numberOfSuspects', label: 'Number of suspects', type: 'number', placeholder: 'e.g. 1' },
        { key: 'previousAdvice', label: 'Client received advice on this before?', type: 'select', options: ['Yes','No'] },
        { key: 'previousAdviceDetails', label: 'Previous advice details', type: 'text', cols: 2, showIf: { field: 'previousAdvice', value: 'Yes' } },
        { key: '_h_signatures', label: 'Signatures', type: 'sectionHeading' },
        { key: '_note_tel_declaration', label: 'Signatures are optional for telephone advice. Enable below only if the client is present or the firm requires a signed copy.', type: 'sectionNote' },
        { key: 'laaClientFullName', label: 'Client Full Name (BLOCK CAPITALS)', type: 'text', cols: 2 },
        { key: 'laaFeeEarnerFullName', label: 'Fee Earner Full Name', type: 'text', placeholder: 'Your full name', cols: 2 },
        { key: 'captureSignatures', label: 'Capture signatures?', type: 'select', options: ['No','Yes'] },
        { key: 'clientSignature', label: 'Client Signature (if present)', type: 'signature', sigKey: 'clientSig', showIf: { field: 'captureSignatures', value: 'Yes' } },
        { key: 'feeEarnerSignature', label: 'Fee Earner Signature', type: 'signature', sigKey: 'feeEarnerSig', showIf: { field: 'captureSignatures', value: 'Yes' } },
        { key: 'feeEarnerCertification', label: 'Certification', type: 'select', options: ['Draft','Finalised'] },
        { key: '_h_admin', label: 'Administration', type: 'sectionHeading' },
        { key: 'ufn', label: 'UFN (Unique File Number)', type: 'text', placeholder: 'DDMMYY/NNN e.g. 220226/001', cols: 2, firmCompletes: true },
        { key: 'firmLaaAccount', label: 'Firm LAA Account No.', type: 'text', placeholder: 'Firm provides this', firmCompletes: true },
        { key: '_h_monitoring', label: 'Equal Opportunities', type: 'sectionHeading' },
        { key: 'ethnicOriginCode', label: 'Ethnic Origin', type: 'codedSelect', codeKey: 'ethnicCodes' },
        { key: 'disabilityCode', label: 'Disability', type: 'codedSelect', codeKey: 'disabilityCodes' },
      ],
    },
  ];

  var activeFormSections = formSections;

  /* ─── CLIENT LOOKUP KEYS (client-pertinent fields only) ─── */
var clientLookupKeys = [
    'title','forename','middleName','surname','gender','dob',
    'nationality','nationalityOther','ethnicOriginCode','disabilityCode',
    'clientPhone','clientEmail','clientEmailConsent',
    'address1','address2','address3','city','county','postCode',
    'niNumber','arcNumber',
    'maritalStatus','employmentStatus',
    'accommodationStatus','accommodationDetails',
    'benefits','benefitType','benefitOther','benefitNotes',
    'passportedBenefit','grossIncome','partnerIncome','partnerName','incomeNotes',
    'medication','psychiatricIssues','psychiatricNotes'
  ];

var REQUIRED_FIELD_KEYS = [
    'date','policeStationId','instructionDateTime','surname','forename','dob','niNumber',
    'matterTypeCode','offence1Details','sufficientBenefitTest','conflictCheckResult',
    'outcomeDecision','laaClientFullName','previousAdvice','disclosureType'
  ];

  function searchClients(query) {
    if (!query || query.length < 2 || !window.api) return Promise.resolve([]);
    var q = query.toLowerCase();
    return (window.api.attendanceListFull || window.api.attendanceList)().then(function (rows) {
      var seen = {};
      var results = [];
      rows.forEach(function (r) {
        var d = safeJson(r.data);
        var ref = (d.ourFileNumber || d.fileReference || '').toLowerCase();
        var sn = (d.surname || '').toLowerCase();
        var fn = (d.forename || '').toLowerCase();
        if (ref.indexOf(q) < 0 && sn.indexOf(q) < 0 && fn.indexOf(q) < 0) return;
        if (!d.surname && !d.forename) return;
        var dedup = (d.surname || '').trim() + '|' + (d.forename || '').trim() + '|' + (d.dob || '');
        if (seen[dedup]) return;
        seen[dedup] = true;
        results.push({ id: r.id, data: d });
      });
      return results.slice(0, 8);
    });
  }

  var _clientDropdown = null;

  function hideClientDropdown() {
    if (_clientDropdown) { _clientDropdown.style.display = 'none'; }
  }

  function showClientDropdown(anchorEl, results) {
    if (!results.length) { hideClientDropdown(); return; }
    if (!_clientDropdown) {
      _clientDropdown = document.createElement('div');
      _clientDropdown.className = 'client-lookup-dropdown';
      document.body.appendChild(_clientDropdown);
    }
    _clientDropdown.innerHTML = '';
    results.forEach(function (r) {
      var d = r.data;
      var item = document.createElement('div');
      item.className = 'client-lookup-item';
      var label = [d.surname, d.forename].filter(Boolean).join(', ');
      if (d.ourFileNumber || d.fileReference) label += ' \u00B7 #' + (d.ourFileNumber || d.fileReference);
      if (d.dob) label += ' \u00B7 DOB: ' + d.dob;
      item.textContent = label;
      item.addEventListener('mousedown', function (e) {
        e.preventDefault();
        applyClientLookup(r);
        hideClientDropdown();
      });
      _clientDropdown.appendChild(item);
    });
    var rect = anchorEl.getBoundingClientRect();
    _clientDropdown.style.top = (rect.bottom + window.scrollY + 2) + 'px';
    _clientDropdown.style.left = rect.left + 'px';
    _clientDropdown.style.width = Math.max(rect.width, 320) + 'px';
    _clientDropdown.style.display = 'block';
  }

  function applyClientLookup(r) {
    var d = r.data;
    clientLookupKeys.forEach(function (k) {
      if (d[k] != null && d[k] !== '') {
        formData[k] = d[k];
        document.querySelectorAll('[data-field="' + k + '"]').forEach(function (el) {
          el.value = String(d[k]);
        });
      }
    });
    formData.clientType = 'Existing';
    formData.caseStatus = 'Existing case';
    setFieldValue('clientType', 'Existing');
    setFieldValue('caseStatus', 'Existing case');
    showClientImportedToast();
  }

  function showClientImportedToast() {
    var el = document.getElementById('autosave-indicator');
    if (!el) return;
    el.textContent = 'Client details imported';
    el.classList.add('visible');
    setTimeout(function () { el.classList.remove('visible'); }, 3000);
  }

  var _clientLookupDebounce = null;
  function triggerClientLookup(inputEl) {
    clearTimeout(_clientLookupDebounce);
    var val = inputEl.value;
    if (!val || val.length < 2) { hideClientDropdown(); return; }
    _clientLookupDebounce = setTimeout(function () {
      searchClients(val).then(function (results) {
        if (inputEl === document.activeElement) showClientDropdown(inputEl, results);
      });
    }, 300);
  }

  /* ─── HELPERS ─── */
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function safeJson(s) {
    if (!s) return {};
    if (typeof s === 'object') return s;
    try { return JSON.parse(s) || {}; } catch (_) { return {}; }
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  var MONTH_NAMES = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
    january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12};

  function parseDobInput(raw) {
    if (!raw) return null;
    var s = raw.trim();
    if (!s) return null;
    var day, mon, yr;

    // Already ISO: YYYY-MM-DD
    var isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) { yr = +isoMatch[1]; mon = +isoMatch[2]; day = +isoMatch[3]; }

    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (2 or 4-digit year)
    if (!day) {
      var sepMatch = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
      if (sepMatch) { day = +sepMatch[1]; mon = +sepMatch[2]; yr = +sepMatch[3]; }
    }

    // DD Mon YYYY or DD Month YYYY
    if (!day) {
      var namedMatch = s.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{2,4})$/);
      if (namedMatch) {
        day = +namedMatch[1];
        mon = MONTH_NAMES[namedMatch[2].toLowerCase()];
        yr = +namedMatch[3];
      }
    }

    // 8-digit run: DDMMYYYY
    if (!day) {
      var runMatch = s.match(/^(\d{2})(\d{2})(\d{4})$/);
      if (runMatch) { day = +runMatch[1]; mon = +runMatch[2]; yr = +runMatch[3]; }
    }

    if (!day || !mon || !yr) return null;

    // 2-digit year: 00-30 => 2000s, 31-99 => 1900s
    if (yr < 100) yr += (yr <= 30 ? 2000 : 1900);

    if (mon < 1 || mon > 12 || day < 1 || day > 31 || yr < 1900 || yr > new Date().getFullYear()) return null;
    var dt = new Date(yr, mon - 1, day);
    if (dt.getFullYear() !== yr || dt.getMonth() !== mon - 1 || dt.getDate() !== day) return null;
    if (dt > new Date()) return null;
    var isoStr = yr + '-' + String(mon).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    var displayStr = String(day).padStart(2, '0') + '/' + String(mon).padStart(2, '0') + '/' + yr;
    return { iso: isoStr, display: displayStr };
  }

  function isoToDobDisplay(iso) {
    if (!iso) return '';
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : iso;
  }

  function ageFromDob(dobStr) {
    if (!dobStr || typeof dobStr !== 'string') return null;
    const parts = dobStr.trim().split(/[-/]/);
    if (parts.length < 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    const birth = new Date(y, m, d);
    if (birth.getFullYear() !== y || birth.getMonth() !== m || birth.getDate() !== d) return null;
    const today = new Date();
    if (birth > today) return null;
    let age = today.getFullYear() - birth.getFullYear();
    const mDiff = today.getMonth() - birth.getMonth();
    if (mDiff < 0 || (mDiff === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }

  function updateDobAgeDisplay(dobInput, container) {
    const ageEl = container.querySelector('.dob-age-display');
    if (!ageEl) return;
    var rawVal = (dobInput && dobInput.value) ? dobInput.value.trim() : '';
    var dobStr = rawVal;
    if (rawVal && !rawVal.match(/^\d{4}-/)) {
      var parsed = parseDobInput(rawVal);
      dobStr = parsed ? parsed.iso : rawVal;
    }
    const age = ageFromDob(dobStr);
    if (age == null) {
      ageEl.textContent = '';
      ageEl.className = 'dob-age-display';
      return;
    }
    formData.clientAge = age;
    ageEl.textContent = 'Age: ' + age + (age <= 17 ? ' (Appropriate adult needed)' : '');
    ageEl.className = 'dob-age-display' + (age <= 17 ? ' dob-age-minor' : '');
  }
  function parseYYYYMMDD(dateStr) {
    const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  function formatDateGB(dateStr) {
    if (!dateStr) return '';
    const d = parseYYYYMMDD(dateStr) || new Date(dateStr);
    if (!d || isNaN(d.getTime())) return String(dateStr);
    try {
      const formatted = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      if (formatted && formatted.length >= 8) return formatted;
    } catch (_) {}
    var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return day + '/' + m + '/' + y;
  }
  /* ─── INPUT VALIDATION HELPERS ─── */
  var PHONE_REGEX = /^[\d\s+\-()]*$/;
  var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var NI_REGEX = /^[A-Za-z]{2}\d{6}[A-Za-z]$/;

  function _getOrCreateFieldError(inputEl) {
    var errEl = inputEl.parentNode.querySelector('.field-error');
    if (!errEl) {
      errEl = document.createElement('span');
      errEl.className = 'field-error';
      errEl.style.display = 'none';
      inputEl.parentNode.appendChild(errEl);
    }
    return errEl;
  }

  function attachPhoneValidation(inputEl) {
    inputEl.addEventListener('input', function () {
      var v = inputEl.value;
      var errEl = _getOrCreateFieldError(inputEl);
      if (v && !PHONE_REGEX.test(v)) {
        errEl.textContent = 'Numbers only (digits, spaces, + and - allowed)';
        errEl.style.display = 'block';
        inputEl.classList.add('input-error');
      } else {
        errEl.style.display = 'none';
        inputEl.classList.remove('input-error');
      }
    });
    inputEl.addEventListener('blur', function () {
      var v = inputEl.value;
      var errEl = _getOrCreateFieldError(inputEl);
      if (v && !PHONE_REGEX.test(v)) {
        errEl.textContent = 'Numbers only (digits, spaces, + and - allowed)';
        errEl.style.display = 'block';
        inputEl.classList.add('input-error');
      } else {
        errEl.style.display = 'none';
        inputEl.classList.remove('input-error');
      }
    });
  }

  function attachEmailValidation(inputEl) {
    inputEl.addEventListener('blur', function () {
      var v = (inputEl.value || '').trim();
      var errEl = _getOrCreateFieldError(inputEl);
      if (v && !EMAIL_REGEX.test(v)) {
        errEl.textContent = 'Please enter a valid email address';
        errEl.style.display = 'block';
        inputEl.classList.add('input-error');
      } else {
        errEl.style.display = 'none';
        inputEl.classList.remove('input-error');
      }
    });
    inputEl.addEventListener('input', function () {
      var v = (inputEl.value || '').trim();
      var errEl = _getOrCreateFieldError(inputEl);
      if (!v || EMAIL_REGEX.test(v)) {
        errEl.style.display = 'none';
        inputEl.classList.remove('input-error');
      }
    });
  }

  function attachNiNumberValidation(inputEl) {
    inputEl.addEventListener('blur', function () {
      var v = (inputEl.value || '').trim().replace(/\s/g, '');
      var errEl = _getOrCreateFieldError(inputEl);
      if (v && !NI_REGEX.test(v)) {
        errEl.textContent = 'NI Number format: AB123456C (2 letters, 6 digits, 1 letter)';
        errEl.style.display = 'block';
        inputEl.classList.add('input-error');
      } else {
        errEl.style.display = 'none';
        inputEl.classList.remove('input-error');
        if (v && NI_REGEX.test(v)) inputEl.value = v.toUpperCase();
      }
    });
    inputEl.addEventListener('input', function () {
      var v = (inputEl.value || '').trim().replace(/\s/g, '');
      var errEl = _getOrCreateFieldError(inputEl);
      if (!v || NI_REGEX.test(v)) {
        errEl.style.display = 'none';
        inputEl.classList.remove('input-error');
      }
    });
  }

  function attachDateValidation(inputEl) {
    inputEl.addEventListener('blur', function () {
      var v = (inputEl.value || '').trim();
      var errEl = _getOrCreateFieldError(inputEl);
      if (v) {
        var d = new Date(v);
        if (isNaN(d.getTime())) {
          errEl.textContent = 'Please enter a valid date';
          errEl.style.display = 'block';
          inputEl.classList.add('input-error');
        } else {
          errEl.style.display = 'none';
          inputEl.classList.remove('input-error');
        }
      } else {
        errEl.style.display = 'none';
        inputEl.classList.remove('input-error');
      }
    });
  }

  function renderPhotoThumbs(secId) {
    const container = document.getElementById('photo-thumbs-' + secId);
    if (!container) return;
    container.innerHTML = '';
    const photos = (formData.photos && formData.photos[secId]) || [];
    photos.forEach((p, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'photo-thumb';
      const img = document.createElement('img');
      img.src = p.dataUrl;
      img.alt = p.name;
      img.title = p.name;
      wrap.appendChild(img);
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'photo-thumb-del'; del.textContent = '\u00D7';
      del.addEventListener('click', () => {
        formData.photos[secId].splice(idx, 1);
        renderPhotoThumbs(secId);
        quietSave();
      });
      wrap.appendChild(del);
      container.appendChild(wrap);
    });
  }
  function codeOptions(key) { return (refData[key] || []).map(c => ({ value: c.code, label: c.code + ' \u2013 ' + c.description })); }

  /* ─── SOCIAL / UNSOCIAL AUTO-CALC ─── */
  function isUnsocialTime(hours, mins, isWeekendBH) {
    if (isWeekendBH) return true;
    const t = hours * 60 + mins;
    return t < 420 || t >= 1140;
  }

  /**
   * Split a time span into social (07:00–19:00 weekday) and unsocial minutes.
   * Handles overnight spans correctly (23:00 → 02:30 = 210 unsocial mins).
   * Pass crossesMidnight=true when the caller knows the span crosses midnight —
   * avoids the ambiguity where startTime===endTime could be 0 or 24 hours.
   */
  function splitSocialUnsocial(startTime, endTime, isWeekendBH, crossesMidnight) {
    if (!startTime || !endTime) return { social: 0, unsocial: 0 };
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let startMins = sh * 60 + sm;
    let endMins = eh * 60 + em;
    /* Resolve overnight: use crossesMidnight hint if provided, else infer from times */
    if (crossesMidnight === true) {
      if (endMins <= startMins) endMins += 1440; /* explicitly crosses midnight */
    } else {
      if (endMins < startMins) endMins += 1440; /* implied overnight (strict less-than avoids 0=24h bug) */
    }
    /* 0-duration span (same time, no crossesMidnight flag) */
    if (endMins === startMins && !crossesMidnight) return { social: 0, unsocial: 0 };
    let social = 0, unsocial = 0;
    for (let m = startMins; m < endMins; m++) {
      const hh = m % 1440;
      if (isWeekendBH || hh < 420 || hh >= 1140) unsocial++;
      else social++;
    }
    return { social, unsocial };
  }

  function autoCalcTimes() {
    const d = formData;
    const isWBH = d.weekendBankHoliday === 'Yes';

    if (d.timeSetOff && d.timeArrival) {
      const t = splitSocialUnsocial(d.timeSetOff, d.timeArrival, isWBH);
      setFieldValue('travelSocial', t.social);
      setFieldValue('travelUnsocial', t.unsocial);
    }
    if (d.timeDeparture && d.timeOfficeHome) {
      const prev = { social: parseInt(getFieldValue('travelSocial')) || 0, unsocial: parseInt(getFieldValue('travelUnsocial')) || 0 };
      const ret = splitSocialUnsocial(d.timeDeparture, d.timeOfficeHome, isWBH);
      setFieldValue('travelSocial', prev.social + ret.social);
      setFieldValue('travelUnsocial', prev.unsocial + ret.unsocial);
    }
    if (d.waitingTimeStart && d.waitingTimeEnd) {
      const w = splitSocialUnsocial(d.waitingTimeStart, d.waitingTimeEnd, isWBH);
      setFieldValue('waitingSocial', w.social);
      setFieldValue('waitingUnsocial', w.unsocial);
    }
    if (d.timeArrival && d.timeDeparture) {
      const station = splitSocialUnsocial(d.timeArrival, d.timeDeparture, isWBH);
      const wSoc = parseInt(getFieldValue('waitingSocial')) || 0;
      const wUns = parseInt(getFieldValue('waitingUnsocial')) || 0;
      setFieldValue('adviceSocial', Math.max(0, station.social - wSoc));
      setFieldValue('adviceUnsocial', Math.max(0, station.unsocial - wUns));
    }
    recalcTotal();
  }

  function recalcTotal() {
    const fields = ['travelSocial','travelUnsocial','waitingSocial','waitingUnsocial','adviceSocial','adviceUnsocial'];
    let total = 0;
    fields.forEach(k => { total += parseInt(getFieldValue(k)) || 0; });
    setFieldValue('totalMinutes', total);
    updateCalcPanel();
  }

  function getFieldValue(key) {
    const el = document.querySelector('[data-field="' + key + '"]');
    return el ? el.value : (formData[key] || '');
  }

  function setFieldValue(key, val) {
    const els = document.querySelectorAll('[data-field="' + key + '"]');
    els.forEach(function(el) {
      el.value = val != null ? String(val) : '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    formData[key] = val != null ? val : '';
  }

  function setFieldValueSilent(key, val) {
    const els = document.querySelectorAll('[data-field="' + key + '"]');
    els.forEach(function(el) { el.value = val != null ? String(val) : ''; });
    formData[key] = val != null ? val : '';
  }

  function addHoursToTime(timeStr, hours) {
    if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr)) return '';
    const [h, m] = timeStr.split(':').map(Number);
    let totalMins = h * 60 + m + hours * 60;
    totalMins = ((totalMins % (24 * 60)) + (24 * 60)) % (24 * 60);
    return pad2(Math.floor(totalMins / 60) % 24) + ':' + pad2(totalMins % 60);
  }

  function calcReviewTimes() {
    const base = getFieldValue('timeDetentionAuthorised') || getFieldValue('relevantTime');
    if (!base) return;
    // Relevant time should mirror detention authorised time.
    if (getFieldValue('relevantTime') !== base) setFieldValue('relevantTime', base);
    setFieldValue('firstReviewDue', addHoursToTime(base, 6));
    setFieldValue('secondReviewDue', addHoursToTime(base, 15));
    setFieldValue('thirdReviewDue', addHoursToTime(base, 24));
  }

  /* ─── ESCAPE FEE CALCULATION ─── */
  function calculateProfitCosts() {
    const r = LAA.national;
    const mins = (k) => parseInt(getFieldValue(k)) || 0;
    const travelCost = (mins('travelSocial') / 60 * r.travel.social) + (mins('travelUnsocial') / 60 * r.travel.unsocial);
    const waitingCost = (mins('waitingSocial') / 60 * r.waiting.social) + (mins('waitingUnsocial') / 60 * r.waiting.unsocial);
    const adviceCost = (mins('adviceSocial') / 60 * r.attendance.social) + (mins('adviceUnsocial') / 60 * r.attendance.unsocial);
    const milesCost = (parseFloat(getFieldValue('milesClaimable')) || 0) * LAA.mileageRate;
    const totalProfit = travelCost + waitingCost + adviceCost;
    const totalWithMiles = totalProfit + milesCost;
    const vat = totalWithMiles * LAA.vatRate;
    const isEscape = totalWithMiles > LAA.escapeThreshold;
    return {
      travel: travelCost, waiting: waitingCost, advice: adviceCost,
      miles: milesCost, totalProfit, totalWithMiles,
      vat, grandTotal: totalWithMiles + vat, isEscape,
      fixedFee: LAA.fixedFee, threshold: LAA.escapeThreshold,
      claimAmount: isEscape ? totalWithMiles : LAA.fixedFee,
      claimVat: (isEscape ? totalWithMiles : LAA.fixedFee) * LAA.vatRate,
    };
  }

  function updateCalcPanel() {
    const panel = document.getElementById('calc-panel');
    if (!panel) return;
    const c = calculateProfitCosts();
    const fmt = (n) => '\u00A3' + n.toFixed(2);
    panel.innerHTML = '<h3>Fee Calculation</h3>' +
      '<table class="calc-table">' +
        '<tr><td>Travel</td><td class="r">' + fmt(c.travel) + '</td></tr>' +
        '<tr><td>Waiting</td><td class="r">' + fmt(c.waiting) + '</td></tr>' +
        '<tr><td>Attendance & Advice</td><td class="r">' + fmt(c.advice) + '</td></tr>' +
        '<tr><td>Mileage (' + (getFieldValue('milesClaimable') || 0) + ' x 45p)</td><td class="r">' + fmt(c.miles) + '</td></tr>' +
        '<tr class="total-row"><td><strong>Total Profit Costs</strong></td><td class="r"><strong>' + fmt(c.totalWithMiles) + '</strong></td></tr>' +
        '<tr><td>Fixed Fee</td><td class="r">' + fmt(c.fixedFee) + '</td></tr>' +
        '<tr><td>Escape Threshold</td><td class="r">' + fmt(c.threshold) + '</td></tr>' +
      '</table>' +
      '<div class="escape-badge ' + (c.isEscape ? 'escape-yes' : 'escape-no') + '">' +
        (c.isEscape ? 'ESCAPE CASE \u2013 Claim at hourly rates (CRM18 required)' : 'STANDARD FIXED FEE \u2013 ' + fmt(c.fixedFee)) +
      '</div>' +
      '<table class="calc-table" style="margin-top:8px;">' +
        '<tr><td>Claim Amount</td><td class="r">' + fmt(c.claimAmount) + '</td></tr>' +
        '<tr><td>VAT (20%)</td><td class="r">' + fmt(c.claimVat) + '</td></tr>' +
        '<tr class="total-row"><td><strong>Total Payable</strong></td><td class="r"><strong>' + fmt(c.claimAmount + c.claimVat) + '</strong></td></tr>' +
      '</table>';
  }

  /* ═══════════════════════════════════════════════
     VIEW MANAGEMENT
     ═══════════════════════════════════════════════ */
  function setFormTitle(title) {
    var el = document.getElementById('form-page-title');
    if (el) el.textContent = title;
    var hft = document.getElementById('header-form-title');
    if (hft) hft.textContent = title;
  }

  /* ─── Cross-device sync status ─── */
  function updateSyncStatusIndicator(data) {
    var el = document.getElementById('sync-status-indicator');
    if (!el) return;
    if (!data || !data.status) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    if (data.status === 'synced') {
      el.textContent = '\u2601 All records synced';
      el.style.color = '#059669';
    } else if (data.status === 'syncing') {
      el.textContent = '\u2601 Syncing\u2026';
      el.style.color = '#d97706';
    } else if (data.status === 'error') {
      el.textContent = '\u2601 Sync error';
      el.style.color = '#dc2626';
    } else {
      el.textContent = '\u2601 Sync';
      el.style.color = '#64748b';
    }
  }

  function triggerManualSync() {
    if (!window.api || !window.api.syncNow) return;
    updateSyncStatusIndicator({ status: 'syncing' });
    window.api.syncNow().then(function(result) {
      if (result && result.ok) {
        updateSyncStatusIndicator({ status: 'synced' });
        refreshSyncCounts();
      } else {
        updateSyncStatusIndicator({ status: 'error' });
        showToast('Sync failed: ' + (result && result.error || 'Unknown error'), 'error');
      }
    }).catch(function() {
      updateSyncStatusIndicator({ status: 'error' });
    });
  }

  function refreshSyncCounts() {
    if (!window.api || !window.api.syncStatus) return;
    window.api.syncStatus().then(function(st) {
      var el = document.getElementById('sync-status-indicator');
      if (!el || !st || !st.enabled) return;
      el.style.display = '';
      if (st.pendingChanges === 0 && st.lastSync) {
        el.innerHTML = '\u2601 <strong>All ' + st.totalRecords + ' record' + (st.totalRecords !== 1 ? 's' : '') + ' synced</strong> \u00b7 ' + new Date(st.lastSync).toLocaleTimeString('en-GB');
        el.style.color = '#059669';
      } else if (st.pendingChanges > 0) {
        var synced = st.totalRecords - st.pendingChanges;
        el.innerHTML = '\u2601 ' + synced + ' of ' + st.totalRecords + ' synced \u00b7 <strong>' + st.pendingChanges + ' pending</strong>';
        el.style.color = '#d97706';
      } else if (!st.lastSync) {
        el.textContent = '\u2601 Not yet synced \u00b7 ' + st.totalRecords + ' record' + (st.totalRecords !== 1 ? 's' : '') + ' waiting';
        el.style.color = '#64748b';
      }
    });
  }

  function showView(name) {
    Object.keys(views).forEach(k => {
      document.getElementById(views[k])?.classList.toggle('active', k === name);
    });
    var isForm = (name === 'new');
    document.body.classList.toggle('form-active', isForm);
    if (!isForm) {
      var hft = document.getElementById('header-form-title');
      if (hft) hft.textContent = '';
      document.body.classList.remove('chrome-collapsed');
    }
    if (name === 'home') { stopAutoSave(); stopPaceClock(); loadHomeView(); }
    if (name === 'list') { stopAutoSave(); stopPaceClock(); refreshList(); }
    if (name === 'firms') loadFirmsList();
    if (name === 'reports') loadReports();
    if (name === 'settings') loadSettings();
    if (name === 'new' && !currentAttendanceId && !Object.keys(formData).length) { activeFormSections = formSections; formData = {}; currentSectionIdx = 0; prefillDefaults(); renderForm(formData); }
  }

  /* ─── HOME / COMMAND CENTER ─── */
  var _homeGreetingTimer = null;

  function loadHomeView() {
    updateHomeGreeting();
    if (_homeGreetingTimer) clearInterval(_homeGreetingTimer);
    _homeGreetingTimer = setInterval(updateHomeGreeting, 60000);
    loadHomeRecent();
    updateHomeStatus();
    updateHomeLicenceCard();
    updateGearLicenceItem();
    initSyncButton();
  }

  function initSyncButton() {
    var btn = document.getElementById('sync-now-btn');
    if (btn && !btn._syncBound) {
      btn._syncBound = true;
      btn.addEventListener('click', function() { triggerManualSync(); });
    }
    if (window.api && window.api.syncStatus) {
      window.api.syncStatus().then(function(st) {
        if (btn) btn.style.display = st && st.enabled ? '' : 'none';
        var indicator = document.getElementById('sync-status-indicator');
        if (indicator) {
          indicator.style.display = st && st.enabled ? '' : 'none';
        }
        if (st && st.enabled) refreshSyncCounts();
      });
    }
    initHomeUpdateButton();
  }

  function initHomeUpdateButton() {
    var btn = document.getElementById('home-check-update-btn');
    if (!btn || btn._updateBound) return;
    btn._updateBound = true;
    btn.addEventListener('click', function() {
      if (!window.api || !window.api.appCheckUpdates) {
        showToast('Updates only apply to the installed app', 'info');
        return;
      }
      btn.disabled = true;
      btn.textContent = '\u21BB Checking\u2026';
      window.api.appCheckUpdates().then(function(res) {
        if (res.status === 'up-to-date') {
          btn.textContent = '\u2713 Up to date';
          btn.style.color = '#059669';
          showToast('You\u2019re on the latest version', 'success');
        } else if (res.status === 'available') {
          btn.textContent = '\u21BB Downloading v' + (res.version || '') + '\u2026';
          btn.style.color = '#d97706';
        } else if (res.status === 'dev') {
          btn.textContent = '\u21BB Check for updates';
          showToast('Updates only apply to the installed app', 'info');
        } else {
          btn.textContent = '\u21BB Check for updates';
          showToast('Could not check: ' + (res.message || 'Unknown error'), 'error');
        }
      }).catch(function() {
        btn.textContent = '\u21BB Check for updates';
        showToast('Update check failed', 'error');
      }).finally(function() {
        btn.disabled = false;
        setTimeout(function() {
          btn.textContent = '\u21BB Check for updates';
          btn.style.color = '';
        }, 10000);
      });
    });
  }

  function updateLicenceFooterBadge(st) {
    var badge = document.getElementById('licence-footer-badge');
    if (!badge) return;
    if (!st || !st.key) {
      badge.textContent = 'No licence';
      badge.style.color = '#dc2626';
      badge.style.fontWeight = '600';
    } else if (st.isTrial) {
      var days = st.daysRemaining != null ? ' (' + st.daysRemaining + 'd left)' : '';
      badge.textContent = 'Trial' + days;
      badge.style.color = '#d97706';
      badge.style.fontWeight = '600';
    } else if (st.status === 'expiring_soon') {
      badge.textContent = 'Subscription \u2014 expiring soon';
      badge.style.color = '#d97706';
      badge.style.fontWeight = '600';
    } else if (st.status === 'active') {
      badge.textContent = 'Subscription active';
      badge.style.color = '#059669';
      badge.style.fontWeight = '600';
    } else if (st.status === 'expired') {
      badge.textContent = 'Licence expired';
      badge.style.color = '#dc2626';
      badge.style.fontWeight = '600';
    } else {
      badge.textContent = 'Licence: ' + (st.status || 'unknown');
      badge.style.color = '#64748b';
      badge.style.fontWeight = '';
    }
    badge.onclick = function() { showView('settings'); setTimeout(function() { document.getElementById('licence-settings-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 150); };
  }

  function updateHomeLicenceCard() {
    var card = document.getElementById('home-enter-licence-card');
    if (!window.api || !window.api.licenceStatus) { if (card) card.style.display = 'none'; return; }
    window.api.licenceStatus().then(function(st) {
      // Update footer badge (visible on every screen)
      updateLicenceFooterBadge(st);
      if (!card) return;
      var isPaid = st && st.key && (st.status === 'active' || st.status === 'expiring_soon') && !st.isTrial;
      card.style.display = isPaid ? 'none' : '';
      // Update card text for trial vs no-licence state
      var titleEl = card.querySelector('p:first-of-type');
      var subEl = card.querySelector('p:last-of-type');
      var btnEl = card.querySelector('button');
      if (st && st.isTrial) {
        var trialDays = st.daysRemaining != null ? ' \u2014 ' + st.daysRemaining + ' day' + (st.daysRemaining !== 1 ? 's' : '') + ' remaining' : '';
        if (titleEl) titleEl.textContent = 'Free trial' + trialDays;
        if (subEl) subEl.innerHTML = 'Enter your paid licence key to activate cloud backup and full access. <strong>custodynote.com/buy</strong>';
        if (btnEl) btnEl.textContent = 'Enter licence key \u2192';
      } else {
        if (titleEl) titleEl.textContent = 'Enter your licence key';
        if (subEl) subEl.innerHTML = 'Paste the key from your email. Get a free trial or buy at <strong>custodynote.com</strong>';
        if (btnEl) btnEl.textContent = 'Enter key \u2192';
      }
    }).catch(function() { if (card) card.style.display = 'none'; });
  }

  function updateGearLicenceItem() {
    if (!window.api || !window.api.licenceStatus) return;
    window.api.licenceStatus().then(function(st) {
      var hasLicence = st && st.key && (st.status === 'active' || st.status === 'expiring_soon');
      var btn = document.querySelector('.gear-item-licence');
      var div = document.querySelector('.gear-divider-licence');
      if (btn) btn.style.display = hasLicence ? 'none' : '';
      if (div) div.style.display = hasLicence ? 'none' : '';
    }).catch(function() {});
  }

  function updateHomeGreeting() {
    var now = new Date();
    var h = now.getHours();
    var greeting = h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
    var el = document.getElementById('home-greeting');
    if (el) el.textContent = greeting;

    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var d = now.getDate();
    var suffix = d === 1 || d === 21 || d === 31 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th';
    var dateStr = days[now.getDay()] + ' ' + d + suffix + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
    var timeStr = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    var dtEl = document.getElementById('home-datetime');
    if (dtEl) dtEl.textContent = dateStr + '  \u00B7  ' + timeStr;
  }

  var _headerClockTimer = null;
  var _lastHeaderDate = '';
  function updateHeaderClock() {
    var now = new Date();
    var clockEl = document.getElementById('header-live-clock');
    if (clockEl) clockEl.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());

    var dateEl = document.getElementById('header-live-date');
    if (dateEl) {
      var todayKey = now.toDateString();
      if (todayKey !== _lastHeaderDate) {
        _lastHeaderDate = todayKey;
        var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        var dd = now.getDate();
        var suffix = (dd === 1 || dd === 21 || dd === 31) ? 'st' : (dd === 2 || dd === 22) ? 'nd' : (dd === 3 || dd === 23) ? 'rd' : 'th';
        dateEl.textContent = days[now.getDay()] + ', ' + dd + suffix + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
      }
    }

    var arrEl = document.getElementById('header-arrival-time');
    if (!arrEl) return;
    var arrival = formData && formData.timeArrival;
    var departure = formData && formData.timeDeparture;
    if (departure) {
      arrEl.innerHTML = '';
      arrEl.style.display = 'none';
    } else if (arrival) {
      var parts = arrival.split(':').map(Number);
      var arrMins2 = parts[0] * 60 + parts[1];
      var nowMins = now.getHours() * 60 + now.getMinutes();
      var diff2 = nowMins - arrMins2;
      if (diff2 < 0) diff2 += 1440;
      var hrs2 = Math.floor(diff2 / 60);
      var mins2 = diff2 % 60;
      var elapsed = hrs2 > 0 ? hrs2 + 'h ' + mins2 + 'm' : mins2 + 'm';
      arrEl.innerHTML = '<span class="arrival-label">Arrived:</span><span class="arrival-value">' + esc(arrival) + '</span><span class="arrival-elapsed">(' + elapsed + ' ago)</span>';
      arrEl.style.display = '';
    } else {
      arrEl.innerHTML = '';
      arrEl.style.display = 'none';
    }
  }
  function startHeaderClock() {
    updateHeaderClock();
    if (_headerClockTimer) clearInterval(_headerClockTimer);
    _headerClockTimer = setInterval(updateHeaderClock, 1000);
  }

  function loadHomeRecent() {
    if (!window.api || !window.api.attendanceList) return;
    window.api.attendanceList().then(function(rows) {
      var list = document.getElementById('home-recent-list');
      var statsEl = document.getElementById('home-stats');
      if (!list) return;
      if (!rows || !rows.length) {
        list.innerHTML = '<li class="home-recent-empty">No records yet. Create your first attendance above.</li>';
        if (statsEl) statsEl.textContent = '';
        return;
      }
      var sorted = rows.slice().sort(function(a, b) { return (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''); });
      var HOME_RECENT_LIMIT = 10;
      var showRows = sorted.slice(0, HOME_RECENT_LIMIT);
      list.innerHTML = showRows.map(function(r) {
        var name = (r.client_name && String(r.client_name).trim()) || 'Unnamed';
        var station = r.station_name || '';
        var date = r.attendance_date || '';
        if (date) {
          var dm = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (dm) date = dm[3] + '/' + dm[2] + '/' + dm[1];
        }
        var status = r.status || 'draft';
        var badgeClass = status === 'finalised' ? 'badge finalised' : 'badge draft';
        return '<li class="home-recent-item" data-id="' + r.id + '">' +
          '<div class="home-item-left"><span class="home-item-name">' + esc(name) + '</span><span class="home-item-meta">' + esc(station) + (station && date ? ' \u00B7 ' : '') + esc(date) + '</span></div>' +
          '<div class="home-item-right"><span class="' + badgeClass + '">' + esc(status) + '</span></div>' +
          '</li>';
      }).join('');
      if (statsEl) {
        var total = rows.length;
        var drafts = 0, finalised = 0;
        rows.forEach(function(r) { if ((r.status || 'draft') === 'finalised') finalised++; else drafts++; });
        var parts = [];
        if (drafts) parts.push(drafts + (drafts === 1 ? ' draft' : ' drafts'));
        if (finalised) parts.push(finalised + ' finalised');
        if (total <= HOME_RECENT_LIMIT) {
          statsEl.textContent = total + ' record' + (total === 1 ? '' : 's') + ' \u2014 ' + parts.join(', ');
        } else {
          statsEl.textContent = 'Showing latest ' + HOME_RECENT_LIMIT + ' of ' + total + ' \u2014 ' + parts.join(', ') + '. Use View all for full list.';
        }
      }
      loadHomeWidgets(rows);
    }).catch(function(err) {
      console.error('[loadHomeRecent]', err);
    });
  }

  function loadHomeWidgets(listRows) {
    var listFn = window.api.attendanceListFull || window.api.attendanceList;
    listFn().then(function(fullRows) {
      loadWeekSummary(fullRows);
      loadNeedsAttention(fullRows);
    }).catch(function() {
      loadWeekSummary(listRows || []);
      loadNeedsAttention([]);
    });
  }

  function loadWeekSummary(rows) {
    var elCases = document.getElementById('hw-cases');
    var elHours = document.getElementById('hw-hours');
    var elDrafts = document.getElementById('hw-drafts');
    var elFinalised = document.getElementById('hw-finalised');
    if (!elCases) return;

    var now = new Date();
    var dayOfWeek = now.getDay();
    var mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
    var mondayStr = monday.getFullYear() + '-' + pad2(monday.getMonth() + 1) + '-' + pad2(monday.getDate());

    var weekCases = 0, weekDrafts = 0, weekFinalised = 0, weekHours = 0;

    (rows || []).forEach(function(r) {
      var rDate = r.attendance_date || r.created_at || '';
      var dateOnly = String(rDate).substring(0, 10);
      if (dateOnly < mondayStr) return;

      weekCases++;
      if ((r.status || 'draft') === 'finalised') weekFinalised++;
      else weekDrafts++;

      if (r.data) {
        try {
          var d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
          var h = parseFloat(d.totalTimeClaimed || d.totalHoursWorked || 0);
          if (!isNaN(h)) weekHours += h;
        } catch (e) {}
      }
    });

    elCases.textContent = weekCases;
    elHours.textContent = weekHours ? weekHours.toFixed(1) : '0';
    elDrafts.textContent = weekDrafts;
    elFinalised.textContent = weekFinalised;
  }

  function loadNeedsAttention(rows) {
    var listEl = document.getElementById('home-needs-attention');
    if (!listEl) return;

    var issues = [];
    (rows || []).forEach(function(r) {
      if ((r.status || 'draft') === 'finalised') return;
      var d = null;
      if (r.data) {
        try { d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; } catch (e) { return; }
      }
      if (!d) return;

      var name = [d.forename, d.surname].filter(Boolean).join(' ') || r.client_name || 'Unnamed';
      var id = r.id;

      if (!d.clientSig) issues.push({ id: id, name: name, reason: 'Missing client signature' });
      if (!d.outcomeDecision && !d.outcomeCode) issues.push({ id: id, name: name, reason: 'No outcome recorded' });
      if (!d.ufn) issues.push({ id: id, name: name, reason: 'Missing UFN' });
      if (!d.feeEarnerSig) issues.push({ id: id, name: name, reason: 'Missing fee earner signature' });
      if (!d.firmId) issues.push({ id: id, name: name, reason: 'No firm assigned' });
    });

    if (!issues.length) {
      listEl.innerHTML = '<li class="home-attention-empty">All caught up \u2014 no records need attention.</li>';
      return;
    }

    var MAX_SHOW = 6;
    var show = issues.slice(0, MAX_SHOW);
    listEl.innerHTML = show.map(function(item) {
      return '<li class="home-attention-item" data-id="' + item.id + '">' +
        '<span class="home-attention-icon">\u26A0</span>' +
        '<span class="home-attention-text">' +
          '<span class="home-attention-name">' + esc(item.name) + '</span>' +
          '<span class="home-attention-reason">' + esc(item.reason) + '</span>' +
        '</span>' +
      '</li>';
    }).join('');

    if (issues.length > MAX_SHOW) {
      listEl.innerHTML += '<li class="home-attention-footer"><button type="button" id="attention-view-all">+ ' + (issues.length - MAX_SHOW) + ' more \u2014 View all drafts</button></li>';
    }

    listEl.querySelectorAll('.home-attention-item').forEach(function(li) {
      var id = parseInt(li.dataset.id, 10);
      if (isNaN(id)) return;
      li.addEventListener('click', function() {
        openAttendance(id);
      });
    });

    var viewAllBtn = document.getElementById('attention-view-all');
    if (viewAllBtn) {
      viewAllBtn.addEventListener('click', function() {
        showView('list');
      });
    }
  }

  function updateHomeStatus() {
    var netEl = document.getElementById('home-net-status');
    if (netEl) {
      var online = navigator.onLine;
      netEl.textContent = online ? 'Internet: Connected' : 'Internet: Not connected';
      netEl.className = 'home-status-item ' + (online ? 'online' : 'offline');
    }
    var backupEl = document.getElementById('home-backup-status');
    if (backupEl && window.api && window.api.getSettings) {
      window.api.getSettings().then(function(s) {
        var folder = s && s.backupFolder;
        if (folder) {
          backupEl.textContent = 'Auto backup: ON (every 2 mins)';
          backupEl.className = 'home-status-item online';
        } else {
          backupEl.textContent = 'Auto backup: OFF';
          backupEl.className = 'home-status-item offline';
        }
      });
    }
  }

  function isSupervisorSectionEnabled() {
    const s = window._appSettingsCache || {};
    return s.showSupervisorReview === 'true';
  }

  function openQuickCapture() {
    showView('quickcapture');
    const now = new Date();
    const dtVal = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + 'T' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    document.getElementById('qc-instruction').value = dtVal;
    document.getElementById('qc-forename').value = '';
    document.getElementById('qc-surname').value = '';
    document.getElementById('qc-offence').value = '';
    document.getElementById('qc-dscc').value = '';
    document.getElementById('qc-setoff').value = '';
    document.getElementById('qc-arrived').value = '';
    const qcFirstContact = document.getElementById('qc-first-contact');
    if (qcFirstContact) qcFirstContact.value = '';
    document.getElementById('qc-referral-name').value = '';
    document.getElementById('qc-referral-phone').value = '';
    document.getElementById('qc-referral-email').value = '';
    document.getElementById('qc-oic-name').value = '';
    const qcOicPhone = document.getElementById('qc-oic-phone');
    const qcOicEmail = document.getElementById('qc-oic-email');
    if (qcOicPhone) qcOicPhone.value = '';
    if (qcOicEmail) qcOicEmail.value = '';
    document.getElementById('qc-custody-number').value = '';
    const qcWorkType = document.getElementById('qc-work-type');
    if (qcWorkType) qcWorkType.value = '';
    document.getElementById('qc-client-status').value = '';
    document.getElementById('qc-weekend-bh').value = '';
    document.getElementById('qc-notes').value = '';

    /* Instructing Firm: Select / Add new (same as main form) */
    qcInitFirmSelector();

    /* Station autocomplete — built inside .station-search-wrap for correct dropdown positioning */
    const stWrap = document.getElementById('qc-station-search-wrap');
    let existInp = stWrap.querySelector('input[type="text"]');
    if (!existInp) {
      existInp = document.createElement('input');
      existInp.type = 'text'; existInp.id = 'qc-station-text'; existInp.placeholder = 'Type to search stations...';
      existInp.autocomplete = 'off';
      stWrap.appendChild(existInp);
      const hidInp = document.createElement('input');
      hidInp.type = 'hidden'; hidInp.id = 'qc-station-id';
      stWrap.appendChild(hidInp);
      const sugList = document.createElement('div');
      sugList.className = 'station-suggestions'; sugList.id = 'qc-station-suggestions';
      stWrap.appendChild(sugList);
      existInp.addEventListener('focus', () => { qcBuildStationSuggestions(existInp.value); sugList.classList.add('open'); });
      existInp.addEventListener('input', () => { qcBuildStationSuggestions(existInp.value); sugList.classList.add('open'); });
      existInp.addEventListener('blur', () => { setTimeout(() => sugList.classList.remove('open'), 150); });
    } else {
      existInp.value = '';
      document.getElementById('qc-station-id').value = '';
    }
  }

  function qcInitFirmSelector() {
    const wrap = document.getElementById('qc-firm-wrap');
    if (!wrap) return;
    const hiddenInput = document.getElementById('qc-firm');
    const choiceRow = document.getElementById('qc-firm-choice-row');
    const selectedLine = document.getElementById('qc-firm-selected');
    const addSection = document.getElementById('qc-firm-add-section');
    const useSection = document.getElementById('qc-firm-use-section');
    const searchInp = document.getElementById('qc-firm-search');
    const resultsDiv = document.getElementById('qc-firm-results');

    function qcSetReferralFromFirm(fi) {
      if (fi) {
        document.getElementById('qc-referral-name').value = fi.contact_name || '';
        document.getElementById('qc-referral-phone').value = fi.contact_phone || '';
        document.getElementById('qc-referral-email').value = fi.contact_email || '';
      }
    }

    function qcUpdateFirmSelectedLine() {
      const fid = (hiddenInput && hiddenInput.value) || '';
      if (!fid) {
        if (selectedLine) selectedLine.style.display = 'none';
        if (choiceRow) choiceRow.style.display = 'flex';
        return;
      }
      const fi = firms.find(function(x) { return String(x.id) === fid; });
      if (fi && selectedLine) {
        selectedLine.style.display = 'block';
        selectedLine.innerHTML = '<span class="form-firm-selected-label">Selected: </span><strong>' + esc(fi.name) + '</strong> <button type="button" class="btn-small form-firm-change">Change</button>';
        selectedLine.querySelector('.form-firm-change').addEventListener('click', function() {
          hiddenInput.value = '';
          qcUpdateFirmSelectedLine();
          choiceRow.style.display = 'flex';
          addSection.style.display = 'none';
          useSection.style.display = 'none';
        });
        choiceRow.style.display = 'none';
      }
    }

    function qcRenderFirmResults(filteredList) {
      if (!resultsDiv) return;
      resultsDiv.innerHTML = '';
      const q = (searchInp && searchInp.value || '').trim().toLowerCase();
      if (!firms.length) {
        resultsDiv.innerHTML = '<div class="firms-search-result-item firms-search-empty">No firms yet. Add a firm first.</div>';
      } else if (q && (!filteredList || !filteredList.length)) {
        resultsDiv.innerHTML = '<div class="firms-search-result-item firms-search-empty">No firms match.</div>';
      } else {
        const list = (filteredList && filteredList.length) ? filteredList : firms;
        list.forEach(function(fi) {
          const item = document.createElement('div');
          item.className = 'firms-search-result-item';
          item.setAttribute('role', 'option');
          item.dataset.firmId = String(fi.id);
          item.innerHTML = '<span class="firms-search-result-name">' + esc(fi.name) + '</span>' + (fi.contact_name ? '<span class="firms-search-result-contact">' + esc(fi.contact_name) + '</span>' : '');
          item.addEventListener('click', function() {
            hiddenInput.value = String(fi.id);
            qcSetReferralFromFirm(fi);
            useSection.style.display = 'none';
            if (searchInp) searchInp.value = '';
            qcUpdateFirmSelectedLine();
          });
          resultsDiv.appendChild(item);
        });
      }
      resultsDiv.classList.add('open');
    }

    hiddenInput.value = '';
    if (addSection) addSection.style.display = 'none';
    if (useSection) useSection.style.display = 'none';
    qcUpdateFirmSelectedLine();

    if (wrap.dataset.qcFirmInit === '1') {
      return;
    }
    wrap.dataset.qcFirmInit = '1';

    var qcPhoneEl = document.getElementById('qc-new-firm-phone');
    if (qcPhoneEl && typeof attachPhoneValidation === 'function') attachPhoneValidation(qcPhoneEl);

    document.getElementById('qc-firm-select-btn').addEventListener('click', function() {
      choiceRow.style.display = 'none';
      addSection.style.display = 'none';
      useSection.style.display = 'block';
      if (searchInp) { searchInp.value = ''; searchInp.focus(); }
      qcRenderFirmResults(filterFirmsBySearch(''));
    });

    document.getElementById('qc-firm-add-btn').addEventListener('click', function() {
      choiceRow.style.display = 'none';
      useSection.style.display = 'none';
      addSection.style.display = 'block';
      document.getElementById('qc-new-firm-name').value = '';
      document.getElementById('qc-new-firm-laa').value = '';
      document.getElementById('qc-new-firm-contact').value = '';
      document.getElementById('qc-new-firm-phone').value = '';
      document.getElementById('qc-new-firm-email').value = '';
      document.getElementById('qc-new-firm-name').focus();
    });

    document.getElementById('qc-add-firm-cancel').addEventListener('click', function() {
      addSection.style.display = 'none';
      qcUpdateFirmSelectedLine();
    });

    document.getElementById('qc-add-firm-btn').addEventListener('click', function() {
      const nameEl = document.getElementById('qc-new-firm-name');
      const name = (nameEl && nameEl.value || '').trim();
      if (!name) { if (nameEl) { nameEl.focus(); nameEl.classList.add('input-error'); } return; }
      if (nameEl) nameEl.classList.remove('input-error');
      const btn = document.getElementById('qc-add-firm-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }
      const newFirm = {
        name: name,
        laa_account: (document.getElementById('qc-new-firm-laa') && document.getElementById('qc-new-firm-laa').value || '').trim(),
        contact_name: (document.getElementById('qc-new-firm-contact') && document.getElementById('qc-new-firm-contact').value || '').trim(),
        contact_phone: (document.getElementById('qc-new-firm-phone') && document.getElementById('qc-new-firm-phone').value || '').trim(),
        contact_email: (document.getElementById('qc-new-firm-email') && document.getElementById('qc-new-firm-email').value || '').trim(),
      };
      window.api.firmSave(newFirm).then(function() { return window.api.firmsList(); }).then(function(f) {
        firms = f;
        const added = firms.find(function(fi) { return fi.name === name; });
        if (added) {
          hiddenInput.value = String(added.id);
          qcSetReferralFromFirm(added);
        }
        addSection.style.display = 'none';
        if (btn) { btn.disabled = false; btn.textContent = 'Add Firm'; }
        qcUpdateFirmSelectedLine();
      }).catch(function() {
        if (btn) { btn.disabled = false; btn.textContent = 'Add Firm'; }
      });
    });

    if (searchInp) {
      searchInp.addEventListener('input', function() { qcRenderFirmResults(filterFirmsBySearch(searchInp.value)); });
      searchInp.addEventListener('focus', function() { qcRenderFirmResults(filterFirmsBySearch(searchInp.value)); });
    }

    /* Do not pre-select a firm - user chooses Select instructing firm or Add new firm */
  }

  function qcBuildStationSuggestions(query) {
    const sugList = document.getElementById('qc-station-suggestions');
    if (!sugList) return;
    sugList.innerHTML = '';
    const q = (query || '').toLowerCase().trim();
    let results = q ? stations.filter(s => (s.name + ' ' + s.code + ' ' + s.scheme).toLowerCase().includes(q)).slice(0, 15)
      : stations.slice(0, 15);
    if (!results.length) { sugList.innerHTML = '<div class="station-suggestion" style="color:var(--text-muted);">No stations found</div>'; return; }
    results.forEach(s => {
      const div = document.createElement('div');
      div.className = 'station-suggestion';
      div.innerHTML = '<strong>' + esc(s.name) + '</strong> <span class="station-code">[' + esc(s.code) + ']</span>';
      div.addEventListener('mousedown', e => {
        e.preventDefault();
        document.getElementById('qc-station-id').value = s.id;
        document.getElementById('qc-station-text').value = s.name + ' [' + s.code + ']';
        sugList.classList.remove('open');
      });
      sugList.appendChild(div);
    });
  }

  function saveQuickCapture(expand) {
    const saveBtn = document.getElementById('qc-save');
    const expandBtn = document.getElementById('qc-expand');
    if (saveBtn) saveBtn.disabled = true;
    if (expandBtn) expandBtn.disabled = true;

    const data = {};
    data.forename = document.getElementById('qc-forename').value.trim();
    data.surname = document.getElementById('qc-surname').value.trim();
    data.offenceSummary = document.getElementById('qc-offence').value.trim();
    data.dsccRef = document.getElementById('qc-dscc').value.trim();
    data.instructionDateTime = document.getElementById('qc-instruction').value;
    if (data.instructionDateTime) data.date = data.instructionDateTime.slice(0, 10);
    data.sourceOfReferral = document.getElementById('qc-source').value;
    const qcWorkTypeEl = document.getElementById('qc-work-type');
    data.workType = (qcWorkTypeEl && qcWorkTypeEl.value) ? qcWorkTypeEl.value : '';
    data.firmContactName = document.getElementById('qc-referral-name').value.trim();
    data.firmContactPhone = document.getElementById('qc-referral-phone').value.trim();
    data.firmContactEmail = document.getElementById('qc-referral-email').value.trim();
    data.oicName = document.getElementById('qc-oic-name').value.trim();
    const qcOicPhoneEl = document.getElementById('qc-oic-phone');
    const qcOicEmailEl = document.getElementById('qc-oic-email');
    data.oicPhone = (qcOicPhoneEl && qcOicPhoneEl.value) ? qcOicPhoneEl.value.trim() : '';
    data.oicEmail = (qcOicEmailEl && qcOicEmailEl.value) ? qcOicEmailEl.value.trim() : '';
    data.custodyNumber = document.getElementById('qc-custody-number').value.trim();
    data.clientStatus = document.getElementById('qc-client-status').value;
    data.weekendBankHoliday = document.getElementById('qc-weekend-bh').value;
    data.arrivalNotes = document.getElementById('qc-notes').value.trim();
    data.timeSetOff = document.getElementById('qc-setoff').value;
    data.timeArrival = document.getElementById('qc-arrived').value;
    if (data.timeArrival) data.timeArrivalStation = data.timeArrival;
    const qcFirstContact = document.getElementById('qc-first-contact');
    data.timeFirstContactWithClient = (qcFirstContact && qcFirstContact.value) ? qcFirstContact.value : (data.timeArrival || '');
    const firmId = document.getElementById('qc-firm').value;
    if (firmId) {
      data.firmId = firmId;
      const fi = firms.find(x => String(x.id) === firmId);
      if (fi) { data.firmName = fi.name; data.firmLaaAccount = fi.laa_account || ''; }
    }
    const stId = document.getElementById('qc-station-id')?.value;
    if (stId) {
      data.policeStationId = stId;
      const st = stations.find(s => String(s.id) === stId);
      if (st) { data.policeStationName = st.name + ' (' + st.scheme + ')'; data.policeStationCode = st.code; data.schemeId = st.code; }
    }
    if (!data.surname && !data.forename) {
      showToast('Please enter at least a client name', 'error');
      if (saveBtn) saveBtn.disabled = false;
      if (expandBtn) expandBtn.disabled = false;
      return;
    }
    formData = data;
    currentSectionIdx = 0;
    currentAttendanceId = null;
    prefillDefaults();
    if (expand) {
      renderForm(formData);
      showView('new');
      if (saveBtn) saveBtn.disabled = false;
      if (expandBtn) expandBtn.disabled = false;
    } else {
      window.api.attendanceSave({ id: null, data: formData, status: 'draft' }).then(id => {
        currentAttendanceId = id;
        showView('home');
      }).finally(() => {
        if (saveBtn) saveBtn.disabled = false;
        if (expandBtn) expandBtn.disabled = false;
      });
    }
  }

  function prefillDefaults() {
    if (!formData._formType) formData._formType = (activeFormSections === telFormSections) ? 'telephone' : 'attendance';
    if (!formData.city && formData.address3 && !formData._addressMigrated) {
      formData.city = formData.address3;
      formData.address3 = '';
      formData._addressMigrated = true;
    }
    if (!formData.travelOriginPostcode) formData.travelOriginPostcode = 'TN156ER';
    if (!formData.clientType) formData.clientType = 'New';
    if (!formData.fitToBeDetained) formData.fitToBeDetained = 'Yes';
    if (!formData.fitToBeInterviewed) formData.fitToBeInterviewed = 'Yes';
    if (!formData.languageIssues) formData.languageIssues = 'No';
    if (!formData.injuriesToClient) formData.injuriesToClient = 'No';
    if (!formData.fmeNurse) formData.fmeNurse = 'No';
    if (!formData.voluntaryInterview) formData.voluntaryInterview = 'No';
    if (!formData.juvenileVulnerable) formData.juvenileVulnerable = 'Not Applicable';
    if (!formData.coSuspects) formData.coSuspects = 'No';
    if (!formData.cctvVisual) formData.cctvVisual = 'No';
    if (!formData.exhibitsToInspect) formData.exhibitsToInspect = 'No';
    if (!formData.writtenEvidence) formData.writtenEvidence = 'No';
    if (!formData.prosecutionWitnesses) formData.prosecutionWitnesses = 'No';
    if (!formData.clientSignedEAB) formData.clientSignedEAB = 'No';
    if (!formData.telephoneAdviceGiven) formData.telephoneAdviceGiven = 'No';
    if (!formData.dutySolicitor) formData.dutySolicitor = 'No';
    if (!formData.alreadyAtStation) formData.alreadyAtStation = 'No';
    if (!formData.multipleJourneys) formData.multipleJourneys = 'No';
    if (!formData.disclosureOfficerIsOIC) formData.disclosureOfficerIsOIC = 'Yes';
    if (!formData.clientEmailConsent) formData.clientEmailConsent = 'No';
    if (!formData.furtherAttendance) formData.furtherAttendance = 'No';
    if (!formData.previousAdvice) formData.previousAdvice = 'No';
    if (!formData.privacyNoticeAccepted) formData.privacyNoticeAccepted = 'No';
    if (!formData.disclosureReInjuries) formData.disclosureReInjuries = 'Not Applicable';
    if (!formData.paceSearches || !Array.isArray(formData.paceSearches)) formData.paceSearches = [{ searchType: '', whatFound: '' }];
    if (!formData.forensicSamples || !Array.isArray(formData.forensicSamples)) formData.forensicSamples = [{ sampleType: '', whatDone: '', notes: '' }];
    if (!formData.thirdPartyEntries || !Array.isArray(formData.thirdPartyEntries)) formData.thirdPartyEntries = [];
    if (!formData.commsLog || !Array.isArray(formData.commsLog)) formData.commsLog = [];
    if (!formData.medicalAuthorities || !Array.isArray(formData.medicalAuthorities)) formData.medicalAuthorities = [];
    if (!formData.otherAuthorities || !Array.isArray(formData.otherAuthorities)) formData.otherAuthorities = [];
    if (!formData.invoiceSent) formData.invoiceSent = 'No';
    /* Migrate old bail data: if bailConditionsChecklist exists but no bailType, set Conditional */
    if (!formData.bailType && formData.bailConditionsChecklist) formData.bailType = 'Conditional';
    window.api.getSettings().then(s => {
      window._appSettingsCache = s || {};
      if (!formData.feeEarnerName && s.feeEarnerNameDefault) formData.feeEarnerName = s.feeEarnerNameDefault;
      if (!formData.laaFeeEarnerFullName && s.feeEarnerNameDefault) formData.laaFeeEarnerFullName = s.feeEarnerNameDefault;
      const today = new Date().toISOString().slice(0, 10);
      const dow = new Date().getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isBH = UK_BANK_HOLIDAYS.includes(today);
      const wbh = (isWeekend || isBH) ? 'Yes' : 'No';
      if (!formData.date) setFieldValue('date', today);
      setFieldValue('weekendBankHoliday', wbh);
    });
  }

  function nextInvoiceFromResult(res) {
    if (res.suggestedNext) return res.suggestedNext;
    if (res.invoices && res.invoices.length > 0) {
      // Numerically sort client-side as well in case main.js wasn't the caller (browser mode)
      const sorted = res.invoices.slice().sort((a, b) => {
        const na = parseInt((a.invoiceNumber || '').replace(/\D/g, ''), 10) || 0;
        const nb = parseInt((b.invoiceNumber || '').replace(/\D/g, ''), 10) || 0;
        return nb - na;
      });
      return sorted[0].invoiceNumber;
    }
    return '';
  }

  function autoFetchNextInvoice() {
    if (!window.api || typeof window.api.quickfileFetchInvoices !== 'function') return;
    window.api.quickfileFetchInvoices().then(res => {
      const next = nextInvoiceFromResult(res);
      if (next) {
        formData.fileReference = next;
        const inp = document.querySelector('input[name="fileReference"]');
        if (inp) inp.value = next;
      }
    }).catch(() => {});
  }

  /* ─── AUTOSAVE (#1) ─── */
  function startAutoSave() {
    stopAutoSave();
    autoSaveTimer = setInterval(quietSave, 10000);
  }

  function stopAutoSave() {
    if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; }
  }

  function hasMeaningfulData(d) {
    var hasIdentity = !!(d.surname || d.forename || d.ufn || d.custodyNumber);
    if (hasIdentity) return true;
    var hasSubstantive = !!(d.offenceSummary || d.ourFileNumber);
    return hasSubstantive;
  }

  function quietSave() {
    const formView = document.getElementById('view-form');
    if (!formView || !formView.classList.contains('active')) return;
    const data = getFormData();
    if (!hasMeaningfulData(data)) return;
    if (_draftSaveInFlight) { _draftSaveQueued = true; return; }
    _draftSaveInFlight = true;
    window.api.attendanceSave({ id: currentAttendanceId, data: data, status: 'draft' }).then(result => {
      if (result && typeof result === 'object' && result.error === 'locked') return; /* finalised — skip autosave */
      if (typeof result === 'number' || typeof result === 'string') currentAttendanceId = result;
      showAutoSaveIndicator();
    }).finally(() => {
      _draftSaveInFlight = false;
      if (_draftSaveQueued) {
        _draftSaveQueued = false;
        setTimeout(() => quietSave(), 0);
      }
    });
  }

  function showAutoSaveIndicator() {
    var now = new Date();
    var txt = 'Saved ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    ['autosave-indicator', 'header-autosave'].forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = txt;
      el.classList.add('visible');
      setTimeout(function() { el.classList.remove('visible'); }, 3000);
    });
  }

  function showSettingsSavedToast() {
    const el = document.getElementById('settings-saved-toast');
    if (!el) return;
    el.classList.add('visible');
    el.textContent = 'Settings saved';
    clearTimeout(el._toastTimer);
    el._toastTimer = setTimeout(() => el.classList.remove('visible'), 2000);
  }

  function purgeEmptyDrafts() {
    if (!window.api) return Promise.resolve();
    return (window.api.attendanceListFull || window.api.attendanceList)().then(rows => {
      const toDelete = rows.filter(r => {
        if (r.status && r.status !== 'draft') return false;
        return !hasMeaningfulData(safeJson(r.data));
      });
      return Promise.all(toDelete.map(r => window.api.attendanceDelete({ id: r.id, reason: 'Auto-purged empty draft' })));
    });
  }

  /* ─── RECENT STATIONS (#12) ─── */
  function loadRecentStations() {
    window.api.getSettings().then(s => {
      try { recentStationIds = JSON.parse(s.recentStations || '[]'); } catch (_) { recentStationIds = []; }
    });
  }

  function saveRecentStation(stationId) {
    if (!stationId) return;
    const id = parseInt(stationId);
    recentStationIds = recentStationIds.filter(x => x !== id);
    recentStationIds.unshift(id);
    if (recentStationIds.length > 5) recentStationIds = recentStationIds.slice(0, 5);
    window.api.setSettings({ recentStations: JSON.stringify(recentStationIds) });
  }

  function loadMagistratesCourts() {
    return fetch('data/magistrates-courts.json')
      .then(function(res) { return res.ok ? res.json() : []; })
      .then(function(list) {
        if (Array.isArray(list)) {
          magistratesCourts = list
            .map(function(x) { return String(x || '').trim(); })
            .filter(Boolean);
        } else {
          magistratesCourts = [];
        }
      })
      .catch(function() {
        magistratesCourts = [];
      });
  }

  /* ─── SETTINGS ─── */
  function loadReports() {
    if (!window.api) return;
    const listFn = window.api.attendanceListFull || window.api.attendanceList;
    listFn().then(rows => {
      const now = new Date();
      const thisMonth = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
      const thisYear = String(now.getFullYear());
      let monthCount = 0, yearCount = 0, escapeCount = 0;
      const firmMap = {}, stationMap = {};
      rows.forEach(r => {
        const d = safeJson(r.data);
        const dt = d.date || r.attendance_date || (r.updated_at ? String(r.updated_at).slice(0, 10) : '') || '';
        if (dt.startsWith(thisMonth)) monthCount++;
        if (dt.startsWith(thisYear)) yearCount++;
        if (d.isEscapeFee === 'Yes' || (d.totalNet && parseFloat(d.totalNet) > LAA.escapeThreshold)) escapeCount++;
        const fn = d.firmName || 'Unknown';
        firmMap[fn] = (firmMap[fn] || 0) + 1;
        const sn = d.policeStationName || r.station_name || 'Unknown';
        stationMap[sn] = (stationMap[sn] || 0) + 1;
      });
      const monthEl = document.getElementById('report-month-total');
      const yearEl = document.getElementById('report-year-total');
      const escEl = document.getElementById('report-escape-count');
      if (monthEl) monthEl.textContent = monthCount + ' attendances';
      if (yearEl) yearEl.textContent = yearCount + ' attendances';
      if (escEl) escEl.textContent = escapeCount;
      const firmDiv = document.getElementById('report-by-firm');
      if (firmDiv) {
        firmDiv.innerHTML = '';
        Object.entries(firmMap).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
          firmDiv.innerHTML += '<div class="report-row"><span class="report-row-label">' + esc(name) + '</span><span class="report-row-val">' + count + '</span></div>';
        });
        if (!Object.keys(firmMap).length) firmDiv.innerHTML = '<div class="report-row" style="color:var(--text-muted)">No data yet</div>';
      }
      const statDiv = document.getElementById('report-by-station');
      if (statDiv) {
        statDiv.innerHTML = '';
        Object.entries(stationMap).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
          statDiv.innerHTML += '<div class="report-row"><span class="report-row-label">' + esc(name) + '</span><span class="report-row-val">' + count + '</span></div>';
        });
        if (!Object.keys(stationMap).length) statDiv.innerHTML = '<div class="report-row" style="color:var(--text-muted)">No data yet</div>';
      }
    });
  }

  function maskLicenceKey(key) {
    if (!key || typeof key !== 'string') return '****';
    var k = key.trim();
    var parts = k.split('-');
    if (parts.length >= 4) {
      var last = parts[parts.length - 1] || '';
      return parts[0] + '-****-****-' + last.slice(-4);
    }
    return k.length >= 4 ? k.slice(0, 4) + '-****-****-' + k.slice(-4) : '****';
  }

  function loadLicenceSettingsUI() {
    if (!window.api || !window.api.licenceStatus) return;
    window.api.licenceStatus().then(function(st) {
      var activeEl = document.getElementById('licence-status-active');
      var noneEl = document.getElementById('licence-status-none');
      var trialUpgradeEl = document.getElementById('licence-trial-upgrade');
      var obscuredEl = document.getElementById('licence-key-obscured');
      var typeBadge = document.getElementById('licence-type-badge');
      var timeEl = document.getElementById('licence-time-remaining');
      var lastValidatedEl = document.getElementById('licence-last-validated');
      var resultEl = document.getElementById('licence-validate-result');
      if (!activeEl || !noneEl) return;
      if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }
      if (st && st.key && (st.status === 'active' || st.status === 'expiring_soon')) {
        noneEl.style.display = 'none';
        activeEl.style.display = '';
        if (obscuredEl) obscuredEl.textContent = maskLicenceKey(st.key);
        if (typeBadge) {
          if (st.isTrial) {
            typeBadge.textContent = 'TRIAL';
            typeBadge.style.background = '#fef3c7';
            typeBadge.style.color = '#92400e';
          } else {
            typeBadge.textContent = 'SUBSCRIPTION';
            typeBadge.style.background = '#d1fae5';
            typeBadge.style.color = '#065f46';
          }
        }
        if (timeEl) {
          if (st.isTrial) {
            timeEl.textContent = 'Free trial \u2014 ' + (st.daysRemaining !== undefined ? st.daysRemaining + ' day' + (st.daysRemaining !== 1 ? 's' : '') + ' remaining' : 'active');
            timeEl.style.color = '#d97706';
          } else if (st.daysRemaining !== undefined) {
            timeEl.textContent = 'Subscription \u2014 ' + st.daysRemaining + ' day' + (st.daysRemaining !== 1 ? 's' : '') + ' remaining';
            timeEl.style.color = '';
          } else if (st.expiresAt) {
            timeEl.textContent = 'Subscription \u2014 expires ' + new Date(st.expiresAt).toLocaleDateString('en-GB');
            timeEl.style.color = '';
          } else {
            timeEl.textContent = 'Subscription active';
            timeEl.style.color = '#059669';
          }
        }
        if (lastValidatedEl) {
          lastValidatedEl.textContent = st.lastValidated ? 'Last validated: ' + new Date(st.lastValidated).toLocaleString('en-GB') : '';
        }
        // Show the inline upgrade box when on a trial
        if (trialUpgradeEl) trialUpgradeEl.style.display = st.isTrial ? '' : 'none';
      } else {
        activeEl.style.display = 'none';
        noneEl.style.display = '';
        if (trialUpgradeEl) trialUpgradeEl.style.display = 'none';
      }
    });
  }

  function loadSettings() {
    if (!window.api) return;
    loadLicenceSettingsUI();
    // Trigger System Status card refresh whenever Settings is opened
    document.dispatchEvent(new CustomEvent('view-settings-shown'));
    window.api.getSettings().then(s => {
      const em = document.getElementById('setting-email');
      if (em) em.value = s.email || '';
      const dp = document.getElementById('setting-dscc-pin');
      if (dp) dp.value = s.dsccPin || '';
      const bf = document.getElementById('setting-backup-folder');
      if (bf) bf.value = s.backupFolder || '';
      const obf = document.getElementById('setting-offsite-backup-folder');
      if (obf) obf.value = s.offsiteBackupFolder || '';
      const cloudUrlEl = document.getElementById('setting-cloud-backup-url');
      if (cloudUrlEl) cloudUrlEl.value = s.cloudBackupUrl || '';
      const cloudTokenEl = document.getElementById('setting-cloud-backup-token');
      if (cloudTokenEl) cloudTokenEl.value = s.cloudBackupToken || '';
      const qfAcc = document.getElementById('setting-quickfile-account');
      const qfKey = document.getElementById('setting-quickfile-apikey');
      const qfApp = document.getElementById('setting-quickfile-appid');
      if (qfAcc) qfAcc.value = s.quickfileAccountNumber || '';
      if (qfKey) qfKey.value = s.quickfileApiKey || '';
      if (qfApp) qfApp.value = s.quickfileAppId || '';
      if (s.laaRates) {
        try {
          const lr = typeof s.laaRates === 'string' ? JSON.parse(s.laaRates) : s.laaRates;
          if (lr.fixedFee) { LAA.fixedFee = +lr.fixedFee; document.getElementById('rate-fixedFee').value = lr.fixedFee; }
          if (lr.escapeThreshold) { LAA.escapeThreshold = +lr.escapeThreshold; document.getElementById('rate-escapeThreshold').value = lr.escapeThreshold; }
          if (lr.attendanceSocial) { LAA.national.attendance.social = +lr.attendanceSocial; document.getElementById('rate-attendanceSocial').value = lr.attendanceSocial; }
          if (lr.attendanceUnsocial) { LAA.national.attendance.unsocial = +lr.attendanceUnsocial; document.getElementById('rate-attendanceUnsocial').value = lr.attendanceUnsocial; }
          if (lr.travelWaiting) { LAA.national.travel.social = +lr.travelWaiting; LAA.national.travel.unsocial = +lr.travelWaiting; LAA.national.waiting.social = +lr.travelWaiting; LAA.national.waiting.unsocial = +lr.travelWaiting; document.getElementById('rate-travelWaiting').value = lr.travelWaiting; }
          if (lr.mileage) { LAA.mileageRate = +lr.mileage; document.getElementById('rate-mileage').value = lr.mileage; }
          if (lr.vat) { LAA.vatRate = +lr.vat / 100; document.getElementById('rate-vat').value = lr.vat; }
        } catch (_) {}
      }
      const fen = document.getElementById('setting-fee-earner-name');
      if (fen) fen.value = s.feeEarnerNameDefault || '';
      const dm = document.getElementById('setting-dark-mode');
      if (dm) dm.checked = s.darkMode === 'true';
      if (s.colourTheme) applyTheme(s.colourTheme);
      const fs = document.getElementById('setting-font-size');
      if (fs && s.fontSize) { fs.value = s.fontSize; }
      const fv = document.getElementById('font-size-val');
      if (fv && s.fontSize) { fv.textContent = s.fontSize + 'px'; }
    });
    if (window.api.getDbPath) {
      window.api.getDbPath().then(p => {
        const el = document.getElementById('settings-db-path');
        if (el) el.textContent = p || 'Unknown';
      });
    }
    const bfEl = document.getElementById('settings-backup-path-display');
    if (bfEl) {
      window.api.getSettings().then(s => {
        bfEl.textContent = s.backupFolder || 'Desktop (default)';
      });
    }
    const obfEl = document.getElementById('settings-offsite-backup-path-display');
    if (obfEl) {
      window.api.getSettings().then(s => {
        obfEl.textContent = (s.offsiteBackupFolder && s.offsiteBackupFolder.trim()) ? s.offsiteBackupFolder : 'None';
      });
    }
    const connEl = document.getElementById('settings-connectivity');
    if (connEl) {
      connEl.textContent = navigator.onLine ? 'Online' : 'Offline (app works fully without internet)';
    }
    if (window.api.isDbEncrypted) {
      const safeStorageCheck = window.api.isSafeStorageAvailable ? window.api.isSafeStorageAvailable() : Promise.resolve(true);
      Promise.all([window.api.isDbEncrypted(), safeStorageCheck]).then(([enc, osProt]) => {
        const el = document.getElementById('encryption-status');
        if (!el) return;
        if (enc && osProt) {
          el.textContent = 'Database is encrypted (AES-256-GCM) — key protected by Windows Credential Store';
          el.style.color = 'green';
        } else if (enc && !osProt) {
          el.textContent = 'Database is encrypted (AES-256-GCM) — key stored in plaintext fallback (OS protection unavailable). Setting a recovery password is strongly recommended.';
          el.style.color = '#c55';
        } else {
          el.textContent = 'Database is not yet encrypted (will encrypt on next save)';
          el.style.color = '';
        }
      });
    }
    if (window.api.hasRecoveryPassword) {
      window.api.hasRecoveryPassword().then(has => {
        const el = document.getElementById('recovery-status');
        if (el) el.textContent = has ? 'Recovery password is SET' : 'No recovery password set — you should set one now';
        if (el) el.style.color = has ? 'green' : '#c00';
      });
    }
    loadFirmsList();
  }

  function saveSettings() {
    window.api.setSettings({
      email: document.getElementById('setting-email')?.value?.trim() || '',
      dsccPin: document.getElementById('setting-dscc-pin')?.value?.trim() || '',
      backupFolder: document.getElementById('setting-backup-folder')?.value?.trim() || '',
      offsiteBackupFolder: document.getElementById('setting-offsite-backup-folder')?.value?.trim() || '',
      cloudBackupUrl: document.getElementById('setting-cloud-backup-url')?.value?.trim() || '',
      cloudBackupToken: document.getElementById('setting-cloud-backup-token')?.value?.trim() || '',
      quickfileAccountNumber: document.getElementById('setting-quickfile-account')?.value?.trim() || '',
      quickfileApiKey: document.getElementById('setting-quickfile-apikey')?.value?.trim() || '',
      quickfileAppId: document.getElementById('setting-quickfile-appid')?.value?.trim() || '',
      feeEarnerNameDefault: document.getElementById('setting-fee-earner-name')?.value?.trim() || '',
      darkMode: document.getElementById('setting-dark-mode')?.checked ? 'true' : 'false',
      fontSize: document.getElementById('setting-font-size')?.value || '16',
      laaRates: JSON.stringify({
        fixedFee: document.getElementById('rate-fixedFee')?.value || '320.00',
        escapeThreshold: document.getElementById('rate-escapeThreshold')?.value || '650.00',
        attendanceSocial: document.getElementById('rate-attendanceSocial')?.value || '62.16',
        attendanceUnsocial: document.getElementById('rate-attendanceUnsocial')?.value || '77.68',
        travelWaiting: document.getElementById('rate-travelWaiting')?.value || '30.36',
        mileage: document.getElementById('rate-mileage')?.value || '0.45',
        vat: document.getElementById('rate-vat')?.value || '20',
      }),
    }).then(() => showToast('Settings saved', 'success'));
  }

  function loadFirmsList() {
    if (!window.api) return;
    window.api.firmsList().then(f => {
      firms = f;
      renderFirmsPage();
      const useSec = document.getElementById('firms-use-existing-section');
      if (useSec && !useSec.classList.contains('firms-section-hidden')) {
        const q = document.getElementById('firms-search-input')?.value || '';
        renderFirmsSearchResults(filterFirmsBySearch(q));
      }
    });
  }

  function filterFirmsBySearch(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return firms.slice();
    return firms.filter(f => {
      const hay = (f.name + ' ' + (f.contact_name || '') + ' ' + (f.contact_email || '') + ' ' + (f.contact_phone || '')).toLowerCase();
      return hay.includes(q);
    });
  }

  function renderFirmsSearchResults(filteredList) {
    const container = document.getElementById('firms-search-results');
    const searchInput = document.getElementById('firms-search-input');
    if (!container) return;
    container.innerHTML = '';
    const query = (searchInput?.value || '').trim();
    if (!firms.length) {
      const item = document.createElement('div');
      item.className = 'firms-search-result-item firms-search-empty';
      item.textContent = 'No firms yet. Add a firm first.';
      item.setAttribute('role', 'option');
      container.appendChild(item);
    } else if (query && !filteredList.length) {
      const item = document.createElement('div');
      item.className = 'firms-search-result-item firms-search-empty';
      item.textContent = 'No firms match.';
      item.setAttribute('role', 'option');
      container.appendChild(item);
    } else {
      (filteredList.length ? filteredList : firms).forEach(firm => {
        const item = document.createElement('div');
        item.className = 'firms-search-result-item';
        item.setAttribute('role', 'option');
        item.dataset.firmId = String(firm.id);
        item.innerHTML = '<span class="firms-search-result-name">' + esc(firm.name) + '</span>' +
          (firm.contact_name ? '<span class="firms-search-result-contact">' + esc(firm.contact_name) + '</span>' : '');
        item.addEventListener('click', () => {
          const idx = firms.findIndex(f => String(f.id) === String(firm.id));
          if (idx >= 0) {
            firmsPage = Math.max(1, Math.ceil((idx + 1) / FIRMS_PER_PAGE));
            renderFirmsPage();
            setTimeout(() => {
              const row = document.querySelector('#firms-list-container tr[data-firm-id="' + firm.id + '"]');
              if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                row.classList.add('firm-row-highlight');
                setTimeout(() => row.classList.remove('firm-row-highlight'), 2500);
              }
            }, 50);
          }
        });
        container.appendChild(item);
      });
    }
    container.classList.toggle('open', true);
  }

  function showFirmsAddSection() {
    const addSec = document.getElementById('firms-add-section');
    const useSec = document.getElementById('firms-use-existing-section');
    const searchInput = document.getElementById('firms-search-input');
    if (addSec) addSec.classList.remove('firms-section-hidden');
    if (useSec) useSec.classList.add('firms-section-hidden');
    if (searchInput) searchInput.value = '';
    document.getElementById('firms-search-results')?.classList.remove('open');
  }

  function showFirmsUseExistingSection() {
    const addSec = document.getElementById('firms-add-section');
    const useSec = document.getElementById('firms-use-existing-section');
    const searchInput = document.getElementById('firms-search-input');
    if (addSec) addSec.classList.add('firms-section-hidden');
    if (useSec) useSec.classList.remove('firms-section-hidden');
    if (searchInput) {
      searchInput.focus();
      const filtered = filterFirmsBySearch(searchInput.value);
      renderFirmsSearchResults(filtered);
    }
  }

  function renderFirmsPage() {
    const container = document.getElementById('firms-list-container');
    const paginationEl = document.getElementById('firms-pagination');
    const pageInfoEl = document.getElementById('firms-page-info');
    const prevBtn = document.getElementById('firms-page-prev');
    const nextBtn = document.getElementById('firms-page-next');
    if (!container) return;
    const totalPages = Math.max(1, Math.ceil(firms.length / FIRMS_PER_PAGE));
    firmsPage = Math.min(Math.max(1, firmsPage), totalPages);
    const start = (firmsPage - 1) * FIRMS_PER_PAGE;
    const pageFirms = firms.slice(start, start + FIRMS_PER_PAGE);
    container.innerHTML = '';
    if (!firms.length) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="5" class="firms-empty">No firms added yet.</td>';
      container.appendChild(row);
    } else {
      pageFirms.forEach(firm => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-firm-id', String(firm.id));
        tr.innerHTML =
          '<td class="firm-name-cell">' + esc(firm.name) + '</td>' +
          '<td>' + esc(firm.contact_name || '') + '</td>' +
          '<td>' + esc(firm.contact_email || '') + '</td>' +
          '<td>' + esc(firm.contact_phone || '') + '</td>' +
          '<td class="firms-actions-col">' +
            '<button type="button" class="btn-star ' + (firm.is_default ? 'default' : '') + '" data-id="' + firm.id + '" title="Set as default">\u2605</button>' +
            '<button type="button" class="btn-small firm-del" data-id="' + firm.id + '">Remove</button>' +
          '</td>';
        tr.querySelector('.firm-del').addEventListener('click', () => {
          showConfirm('Remove ' + firm.name + '?').then(function(ok) { if (ok) window.api.firmDelete(firm.id).then(loadFirmsList); });
        });
        tr.querySelector('.btn-star').addEventListener('click', () => {
          window.api.firmSetDefault(firm.id).then(loadFirmsList);
        });
        container.appendChild(tr);
      });
    }
    if (paginationEl) paginationEl.style.display = firms.length > FIRMS_PER_PAGE ? 'flex' : 'none';
    if (pageInfoEl) pageInfoEl.textContent = totalPages > 1 ? 'Page ' + firmsPage + ' of ' + totalPages : '';
    if (prevBtn) prevBtn.disabled = firmsPage <= 1;
    if (nextBtn) nextBtn.disabled = firmsPage >= totalPages;
  }

  function addFirm() {
    const name = document.getElementById('new-firm-name')?.value?.trim();
    const contact = document.getElementById('new-firm-contact')?.value?.trim();
    const phone = document.getElementById('new-firm-phone')?.value?.trim();
    const email = document.getElementById('new-firm-email')?.value?.trim();
    if (!name) { showToast('Enter a firm name', 'error'); document.getElementById('new-firm-name')?.classList.add('input-error'); return; }
    if (phone && !PHONE_REGEX.test(phone)) { showToast('Phone: numbers only (digits, spaces, + and - allowed)', 'error'); return; }
    if (email && !EMAIL_REGEX.test(email)) { showToast('Please enter a valid email address', 'error'); return; }
    document.getElementById('new-firm-name')?.classList.remove('input-error');
    window.api.firmSave({ name: name, contact_name: contact || '', contact_phone: phone || '', contact_email: email || '' }).then(() => {
      document.getElementById('new-firm-name').value = '';
      document.getElementById('new-firm-contact').value = '';
      document.getElementById('new-firm-phone').value = '';
      document.getElementById('new-firm-email').value = '';
      loadFirmsList();
      window.api.firmsList().then(f => { firms = f; });
    });
  }

  function importFirmsFromQuickFile() {
    var btn = document.getElementById('btn-import-qf-clients');
    var status = document.getElementById('qf-import-status');
    if (!window.api || !window.api.quickfileFetchClients) {
      showToast('QuickFile client import is not available', 'error');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Fetching from QuickFile…';
    if (status) status.textContent = '';
    window.api.quickfileFetchClients().then(function (res) {
      var clients = res.clients || [];
      if (!clients.length) {
        showToast('No clients found in your QuickFile account', 'warning');
        return;
      }
      var existingNames = firms.map(function (f) { return f.name.toLowerCase().trim(); });
      var added = 0;
      var skipped = 0;
      var saves = [];
      clients.forEach(function (c) {
        if (!c.companyName) return;
        if (existingNames.indexOf(c.companyName.toLowerCase().trim()) >= 0) {
          skipped++;
          return;
        }
        added++;
        saves.push(window.api.firmSave({
          name: c.companyName,
          contact_name: c.contactName || '',
          contact_email: c.email || '',
          contact_phone: c.telephone || '',
          address: c.address || ''
        }));
      });
      return Promise.all(saves).then(function () {
        loadFirmsList();
        window.api.firmsList().then(function (f) { firms = f; });
        var msg = added + ' firm' + (added !== 1 ? 's' : '') + ' imported';
        if (skipped) msg += ', ' + skipped + ' already existed';
        if (status) status.textContent = msg;
        showToast(msg, 'success');
      });
    }).catch(function (err) {
      showToast('QuickFile error: ' + (err.message || err), 'error');
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = 'Import firms from QuickFile';
    });
  }

  /* ─── DARK MODE (#13) ─── */
  function applyDarkMode(enabled) {
    document.documentElement.classList.toggle('dark', enabled);
  }

  function applyTheme(theme) {
    var el = document.documentElement;
    ['theme-light', 'theme-slate', 'theme-midnight', 'theme-teal', 'theme-emerald', 'theme-rose', 'theme-purple', 'theme-charcoal', 'theme-copper'].forEach(function(cls) {
      el.classList.remove(cls);
    });
    if (theme && theme !== 'default') {
      el.classList.add('theme-' + theme);
    }
    var swatches = document.querySelectorAll('.theme-swatch');
    swatches.forEach(function(sw) {
      sw.classList.toggle('theme-swatch-active', sw.getAttribute('data-theme') === (theme || 'default'));
    });
  }

  function initDarkMode() {
    window.api.getSettings().then(s => {
      applyDarkMode(s.darkMode === 'true');
      if (s.colourTheme) applyTheme(s.colourTheme);
    });
  }

  /* ─── LIST VIEW ─── */
  var listStatusFilter = 'all';
  var listSortMode = 'newest';

  function refreshList() {
    const ul = document.getElementById('attendance-list');
    if (!ul || !window.api) return;
    /* Use full list (with data blob) so we can show name/date from form JSON when index columns are empty. */
    window.api.attendanceListFull().then(rows => {
      const q = (document.getElementById('list-search')?.value || '').toLowerCase();
      let filtered = q ? rows.filter(r => {
        const d = safeJson(r.data);
        const hay = [
          r.client_name, r.station_name, r.dscc_ref, r.attendance_date, r.status,
          d.forename, d.middleName, d.surname, d.custodyNumber, d.ufn, d.date, d.policeStationName, d.fileReference, d.dsccRef, d.ourFileNumber
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      }) : rows.slice();
      if (listStatusFilter === 'draft') filtered = filtered.filter(r => (r.status || 'draft') === 'draft');
      else if (listStatusFilter === 'finalised') filtered = filtered.filter(r => r.status === 'finalised');
      if (listSortMode === 'oldest') filtered.reverse();
      else if (listSortMode === 'name') filtered.sort((a, b) => {
        const da = safeJson(a.data), db = safeJson(b.data);
        const na = (a.client_name || [da.surname, da.forename].filter(Boolean).join(', ') || '').toLowerCase();
        const nb = (b.client_name || [db.surname, db.forename].filter(Boolean).join(', ') || '').toLowerCase();
        return na.localeCompare(nb);
      });
      else if (listSortMode === 'station') filtered.sort((a, b) => {
        const da = safeJson(a.data), db = safeJson(b.data);
        const sa = (a.station_name || da.policeStationName || '').toLowerCase();
        const sb = (b.station_name || db.policeStationName || '').toLowerCase();
        return sa.localeCompare(sb);
      });
      ul.innerHTML = '';
      if (!filtered.length) {
        ul.innerHTML = '<li class="empty-state"><p>No attendances yet. Click "New Attendance" to start.</p></li>';
        renderListPagination(0);
        return;
      }
      const totalPages = Math.ceil(filtered.length / LIST_PER_PAGE);
      if (listPage > totalPages) listPage = totalPages;
      if (listPage < 1) listPage = 1;
      const start = (listPage - 1) * LIST_PER_PAGE;
      const pageItems = filtered.slice(start, start + LIST_PER_PAGE);
      pageItems.forEach(r => {
        const d = safeJson(r.data);
        const title = (r.client_name && String(r.client_name).trim()) || [d.surname, d.forename].filter(Boolean).join(', ') || 'Draft (no name)';
        const rawDate = r.attendance_date || d.date || (r.updated_at ? String(r.updated_at).slice(0, 10) : '') || '';
        let dateLabel = rawDate ? formatDateGB(rawDate) : '';
        if (dateLabel && /^\d{4}-\d{2}-\d{2}/.test(dateLabel)) {
          const parts = dateLabel.slice(0, 10).split('-');
          if (parts.length === 3) dateLabel = parts[2] + '/' + parts[1] + '/' + parts[0];
        }
        const stationLabel = d.policeStationName || r.station_name || '';
        const dsccLabel = d.dsccRef || r.dscc_ref || '';
        const fileNumLabel = d.ourFileNumber ? '#' + d.ourFileNumber : '';
        const meta = [fileNumLabel, dateLabel, stationLabel, dsccLabel].filter(Boolean).join(' \u00B7 ');
        const formTypeBadge = d._formType === 'telephone' ? '<span class="badge badge-tel">TEL</span>' : '<span class="badge badge-att">ATT</span>';
        const li = document.createElement('li');
        li.innerHTML = '<div class="list-item-text"><span class="title">' + esc(title) + '</span><div class="meta">' + esc(meta) + '</div></div>' +
          '<div class="list-item-actions">' +
            '<div class="list-item-badges">' +
              formTypeBadge +
              '<span class="badge ' + (r.status || 'draft') + '">' + (r.status || 'draft') + '</span>' +
            '</div>' +
            '<div class="list-item-btns" role="group" aria-label="Record actions">' +
              '<button type="button" class="btn-list-action amend-btn" title="Open record to edit (amend)" data-id="' + r.id + '">Edit</button>' +
              '<button type="button" class="btn-list-action dup-btn" title="Duplicate for further visit" data-id="' + r.id + '">Duplicate</button>' +
              '<button type="button" class="btn-list-action new-matter-btn" title="New matter (same client)" data-id="' + r.id + '">New matter</button>' +
              '<button type="button" class="btn-list-action delete-btn" title="Delete this record" data-id="' + r.id + '">Delete</button>' +
            '</div>' +
          '</div>';
        li.querySelector('.list-item-text')?.addEventListener('click', () => openAttendance(r.id));
        if (!li.querySelector('.list-item-text')) {
          li.addEventListener('click', (e) => { if (!e.target.closest('.btn-list-action')) openAttendance(r.id); });
        }
        li.querySelector('.amend-btn').addEventListener('click', (e) => { e.stopPropagation(); amendAttendance(r.id, r.status, title); });
        li.querySelector('.dup-btn').addEventListener('click', (e) => { e.stopPropagation(); duplicateAttendance(r.id); });
        li.querySelector('.new-matter-btn').addEventListener('click', (e) => { e.stopPropagation(); newMatterFromAttendance(r.id); });
        li.querySelector('.delete-btn').addEventListener('click', (e) => { e.stopPropagation(); deleteAttendance(r.id, title); });
        ul.appendChild(li);
      });
      renderListPagination(filtered.length);
    });
  }

  function renderListPagination(total) {
    const pag = document.getElementById('list-pagination');
    if (!pag) return;
    const totalPages = Math.ceil(total / LIST_PER_PAGE);
    if (totalPages <= 1) { pag.style.display = 'none'; return; }
    pag.style.display = '';
    document.getElementById('list-page-info').textContent = 'Page ' + listPage + ' of ' + totalPages + ' (' + total + ' records)';
    document.getElementById('list-page-prev').disabled = listPage <= 1;
    document.getElementById('list-page-next').disabled = listPage >= totalPages;
  }

  /* ─── AMEND ATTENDANCE ─── */
  function amendAttendance(id, status, title) {
    if (status === 'finalised') {
      showConfirm('Re-open "' + (title || 'this record') + '" for amendment?\n\nThe status will change back to draft until you re-finalise.').then(function(ok) {
        if (!ok) return;
        window.api.attendanceSave({ id: id, data: null, status: 'draft', unlock: true }).then(function() {
          openAttendance(id);
        });
      });
    } else {
      openAttendance(id);
    }
  }

  /* ─── DELETE ATTENDANCE (#13) ─── */
  function deleteAttendance(id, title) {
    showConfirm('Delete "' + title + '"?\n\nFinalised records are archived (not permanently removed) to maintain the audit trail. Draft records are permanently deleted.', 'Confirm Delete').then(function(ok) {
      if (!ok) return;
      window.api.attendanceDelete({ id: id, reason: 'User deleted from list' }).then(function(result) {
        if (result && result.soft) showToast('Record archived (finalised — kept in audit trail)', 'info');
        else showToast('Draft deleted', 'info');
        refreshList();
      });
    });
  }

  /* ─── DUPLICATE ATTENDANCE (#8) ─── */
  function duplicateAttendance(id) {
    window.api.attendanceGet(id).then(row => {
      if (!row || !row.data) return;
      const src = safeJson(row.data);
      const copyKeys = ['title','surname','forename','middleName','gender','dob','custodyNumber','clientPhone','clientEmail',
        'clientEmailConsent','address1','address2','address3','city','county','postCode','accommodationStatus',
        'accommodationDetails','maritalStatus','employmentStatus','niNumber','arcNumber',
        'benefits','benefitType','benefitOther','benefitNotes','passportedBenefit','grossIncome','partnerIncome','partnerName','incomeNotes',
        'nationality','nationalityOther','ethnicOriginCode','disabilityCode','riskAssessment',
        'groundsForArrest','groundsForDetention','dateOfArrest','custodyRecordRead','custodyRecordIssues',
        'medication','psychiatricIssues','psychiatricNotes','literate','drugsTest','medicalExaminationOutcome',
        'juvenileVulnerable','appropriateAdultName','appropriateAdultRelation','appropriateAdultPhone','appropriateAdultEmail','appropriateAdultOrganisation','appropriateAdultAddress',
        'oicName','oicEmail','oicPhone','oicUnit',
        'firmContactName','firmContactPhone','firmContactEmail','offenceSummary',
        'nameOfComplainant','witnessIntimidation','coSuspectDetails','coSuspectConflict','coSuspectConflictNotes','cctvViewed','exhibitsInspected','exhibitsNotes','writtenEvidenceDetails','pncDisclosed','pncNotes','samplesDisclosed','paceSearches','forensicSamples','cautionAvailable','clothingShoesSeized',
        'offence1Details','offence1Date','offence1ModeOfTrial','offence1Statute',
        'offence2Details','offence2Date','offence2ModeOfTrial','offence2Statute',
        'offence3Details','offence3Date','offence3ModeOfTrial','offence3Statute',
        'offence4Details','offence4Date','offence4ModeOfTrial','offence4Statute','otherOffencesNotes',
        'matterTypeCode','policeStationId','policeStationName','firmId','firmLaaAccount','firmName',
        'multipleJourneys','waitingTimeStart','waitingTimeEnd','waitingTimeNotes',
        'outcomeOffence3Details','outcomeOffence3Statute','outcomeOffence4Details','outcomeOffence4Statute',
        'dsccRef','sourceOfReferral','fileReference','travelOriginPostcode','schemeId',
        'instructionDateTime','weekendBankHoliday','otherLocation','dutySolicitor','clientStatus','telephoneAdviceGiven','feeEarnerTelephoneAdvice','arrivalNotes'];
      formData = {};
      copyKeys.forEach(k => { if (src[k]) formData[k] = src[k]; });
      formData.workType = 'Further Police Station Attendance';
      formData.caseStatus = 'Existing case';
      formData.clientType = 'Existing';
      currentAttendanceId = null;
      currentSectionIdx = 0;
      prefillDefaults();
      setTimeout(() => {
        copyKeys.forEach(k => { if (src[k]) formData[k] = src[k]; });
        formData.workType = 'Further Police Station Attendance';
        formData.caseStatus = 'Existing case';
        formData.clientType = 'Existing';
        renderForm(formData);
        showView('new');
      }, 200);
    });
  }

  /* ─── NEW MATTER (SAME CLIENT) ─── Copy only client personal details; new file number on save */
  var clientPersonalKeys = ['title','forename','middleName','surname','dob','gender','address1','address2','address3','city','county','postCode','clientPhone','clientEmail','clientEmailConsent','nationality','nationalityOther','accommodationStatus','accommodationDetails','maritalStatus','employmentStatus','niNumber','arcNumber','benefits','benefitType','benefitOther','benefitNotes','passportedBenefit','grossIncome','partnerIncome','partnerName','incomeNotes','ethnicOriginCode','disabilityCode','riskAssessment','juvenileVulnerable','appropriateAdultName','appropriateAdultRelation','appropriateAdultPhone','appropriateAdultEmail','appropriateAdultOrganisation','appropriateAdultAddress','interpreterName','interpreterLanguage','languageIssues'];

  function newMatterFromAttendance(id) {
    window.api.attendanceGet(id).then(row => {
      if (!row || !row.data) return;
      const src = safeJson(row.data);
      formData = {};
      clientPersonalKeys.forEach(k => { if (src[k] !== undefined && src[k] !== '') formData[k] = src[k]; });
      formData.workType = 'First Police Station Attendance';
      formData.clientType = 'Existing';
      formData.caseStatus = 'New case';
      currentAttendanceId = null;
      currentSectionIdx = 0;
      activeFormSections = formSections;
      prefillDefaults();
      setTimeout(() => {
        clientPersonalKeys.forEach(k => { if (src[k] !== undefined && src[k] !== '') formData[k] = src[k]; });
        formData.workType = 'First Police Station Attendance';
        formData.clientType = 'Existing';
        formData.caseStatus = 'New case';
        renderForm(formData);
        showView('new');
      }, 200);
    });
  }

  function openAttendance(id) {
    currentStandaloneSectionId = null;
    currentAttendanceId = id;
    window.api.attendanceGet(id).then(row => {
      currentRecordStatus = row ? row.status : null;
      currentRecordArchived = !!(row && row.archived_at);
      formData = row && row.data ? safeJson(row.data) : {};
      activeFormSections = (formData._formType === 'telephone') ? telFormSections : formSections;
      currentSectionIdx = 0;
      renderForm(formData);
      showView('new');
    });
  }

  /* ─── CONVERT TELEPHONE TO ATTENDANCE (Spec 9.74) ─── */
  function convertTelephoneToAttendance() {
    collectCurrentData();
    var src = JSON.parse(JSON.stringify(formData));
    var sharedKeys = [
      'title','forename','middleName','surname','gender','dob','nationality','nationalityOther',
      'clientPhone','clientEmail','address1','address2','address3','city','county','postCode',
      'niNumber','arcNumber','clientType','benefits','benefitType','benefitOther','passportedBenefit','employmentStatus',
      'ethnicOriginCode','disabilityCode',
      'policeStationId','policeStationName','schemeId','firmId','firmName','firmLaaAccount',
      'firmContactName','firmContactPhone','firmContactEmail','feeEarnerName',
      'dsccRef','sourceOfReferral','fileReference','instructionDateTime',
      'dutySolicitor','weekendBankHoliday',
      'matterTypeCode','offenceSummary','offence1Details','offence1Date','offence1ModeOfTrial','offence1Statute',
      'offence2Details','offence2Date','offence2ModeOfTrial','offence2Statute',
      'caseSummary','conflictCheckResult','conflictCheckNotes','coSuspects','coSuspectDetails',
      'previousAdvice','previousAdviceDetails','feeCode'
    ];
    showConfirm(
      'Convert this telephone advice to an attendance note?\n\n' +
      'Per LAA Spec 9.74, if telephone advice is followed by attendance, you claim INVC only (not both).\n\n' +
      'This will:\n• Save the current telephone record as "Converted to attendance"\n• Open a new attendance form pre-filled with shared data',
      'Convert to Attendance'
    ).then(function(ok) {
      if (!ok) return;
      src._convertedToAttendance = true;
      src.outcomeDecision = 'Attendance now required';
      formData = src;
      quietSave();
      var newData = {};
      sharedKeys.forEach(function(k) { if (src[k]) newData[k] = src[k]; });
      newData._formType = 'attendance';
      newData.workType = 'First Police Station Attendance';
      newData._convertedFromTelephone = true;
      newData._sourceUfn = src.ufn || '';
      formData = newData;
      currentAttendanceId = null;
      currentSectionIdx = 0;
      activeFormSections = formSections;
      prefillDefaults();
      renderForm(formData);
      showView('new');
      showToast('Converted to attendance \u2013 telephone record saved', 'success');
    });
  }

  /* ═══════════════════════════════════════════════
     FORM RENDERING
     ═══════════════════════════════════════════════ */
  function showSection(idx) {
    collectCurrentData();
    let target = Math.max(0, Math.min(idx, activeFormSections.length - 1));
    const dir = target >= currentSectionIdx ? 1 : -1;
    while (true) {
      const el = document.querySelector('.form-section[data-sec-idx="' + target + '"]');
      if (!el || el.style.display !== 'none') break;
      target += dir;
      if (target < 0 || target >= activeFormSections.length) break;
    }
    currentSectionIdx = Math.max(0, Math.min(target, activeFormSections.length - 1));
    document.querySelectorAll('.form-section').forEach((el, i) => el.classList.toggle('active', i === currentSectionIdx));
    setFormTitle(activeFormSections[currentSectionIdx].title);
    if (activeFormSections[currentSectionIdx].id === 'timeRecording') { autoCalcTimes(); updateCalcPanel(); }
    if (activeFormSections[currentSectionIdx].id === 'journeyTime') { autoCalcTimes(); }
    autoFillFromClient();
    applyConditionalVisibility();
    updateContextBar();
    buildSectionsIndex();
    updateProgressBar();
    const form = document.getElementById('attendance-form');
    if (form) form.scrollTop = 0;
  }

  function updateFormBarVisibility() {
    const finaliseBar = document.getElementById('form-finalise-bar');
    const archiveBtn = document.getElementById('form-archive-btn');
    const unarchiveBtn = document.getElementById('form-unarchive-btn');
    if (!finaliseBar || !archiveBtn || !unarchiveBtn) return;
    if (currentAttendanceId && currentRecordStatus !== 'finalised' && !currentRecordArchived) {
      finaliseBar.style.display = '';
    } else {
      finaliseBar.style.display = 'none';
    }
    if (currentAttendanceId && !currentRecordArchived) {
      archiveBtn.style.display = '';
      unarchiveBtn.style.display = 'none';
    } else if (currentAttendanceId && currentRecordArchived) {
      archiveBtn.style.display = 'none';
      unarchiveBtn.style.display = '';
    } else {
      archiveBtn.style.display = 'none';
      unarchiveBtn.style.display = 'none';
    }
  }

  /* ─── AUTO-FILL DECLARATION & RETAINER FROM CLIENT (#4) ─── */
  function autoFillFromClient() {
    const sec = activeFormSections[currentSectionIdx];
    if (sec.id === 'laaDeclaration' || sec.id === 'telDeclaration') {
      if (!formData.laaClientFullName && (formData.forename || formData.surname)) {
        const full = [formData.forename, formData.surname].filter(Boolean).join(' ').toUpperCase();
        setFieldValue('laaClientFullName', full);
        formData.laaClientFullName = full;
      }
      // Signature date/time is now auto-stamped when signing.
      if (!formData.laaSignatureDate && formData.date && (formData.clientSig || formData.feeEarnerSig)) {
        setFieldValueSilent('laaSignatureDate', formData.date);
      }
      if (!formData.laaFeeEarnerFullName && formData.feeEarnerName) {
        setFieldValue('laaFeeEarnerFullName', formData.feeEarnerName);
        formData.laaFeeEarnerFullName = formData.feeEarnerName;
      }
    }
    if (sec.id === 'consents') {
      if (!formData.retainerClientName && (formData.forename || formData.surname)) {
        const full = [formData.forename, formData.surname].filter(Boolean).join(' ');
        setFieldValue('retainerClientName', full);
        formData.retainerClientName = full;
      }
      if (!formData.retainerDob && formData.dob) {
        setFieldValue('retainerDob', formData.dob);
        formData.retainerDob = formData.dob;
      }
      if (!formData.retainerAddress && formData.address1) {
        const addr = [formData.address1, formData.address2, formData.address3, formData.city, formData.county, formData.postCode].filter(Boolean).join('\n');
        setFieldValue('retainerAddress', addr);
        formData.retainerAddress = addr;
      }
      if (!formData.retainerSolicitorName) {
        let fn = formData.firmName;
        if (!fn && formData.firmId) {
          const firm = firms.find(f => String(f.id) === String(formData.firmId));
          if (firm) fn = firm.name;
        }
        if (fn) { setFieldValue('retainerSolicitorName', fn); formData.retainerSolicitorName = fn; }
      }
      if (!formData.retainerDate && formData.date) {
        setFieldValue('retainerDate', formData.date);
        formData.retainerDate = formData.date;
      }
    }
    if (sec.id === 'outcome') {
      var od = formData.outcomeDecision;
      if (od === 'Charged without Bail' || od === 'Charged with Bail' || od === 'Remanded in Custody') {
        var hasCharges = formData.outcomeOffence1Details || formData.outcomeOffence2Details;
        var hasOffences = formData.offence1Details;
        if (!hasCharges && hasOffences && !formData._chargesPrefilled) {
          showConfirm('Pre-fill charges from offences recorded in Section 4?').then(function(ok) {
            if (!ok) { formData._chargesPrefilled = true; return; }
            for (var n = 1; n <= 4; n++) {
              var det = formData['offence' + n + 'Details'];
              var stat = formData['offence' + n + 'Statute'];
              if (det) { formData['outcomeOffence' + n + 'Details'] = det; setFieldValue('outcomeOffence' + n + 'Details', det); }
              if (stat) { formData['outcomeOffence' + n + 'Statute'] = stat; setFieldValue('outcomeOffence' + n + 'Statute', stat); }
            }
            formData._chargesPrefilled = true;
          });
        }
      }
    }
  }

  /* ─── CONTEXT BAR (#6) – Client | Station (left) | Date/time (right, posh format) ─── */
  function ordinalSuffix(d) {
    if (d > 3 && d < 21) return 'th';
    switch (d % 10) { case 1: return 'st'; case 2: return 'nd'; case 3: return 'rd'; default: return 'th'; }
  }
  function poshDateTime(dateStr, timeStr) {
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var d;
    if (dateStr) {
      var parts = dateStr.split('-');
      d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      d = new Date();
    }
    if (isNaN(d.getTime())) d = new Date();
    var dayName = days[d.getDay()];
    var day = d.getDate();
    var month = months[d.getMonth()];
    var year = d.getFullYear();
    var result = dayName + ' ' + day + ordinalSuffix(day) + ' ' + month + ' ' + year;
    if (timeStr) result += ' \u2014 ' + timeStr;
    return result;
  }
  function updateContextBar() {
    const bar = document.getElementById('form-context-bar');
    if (!bar) return;
    const clientName = [formData.forename, formData.surname].filter(Boolean).join(' ') || '\u2014';
    const station = formData.policeStationName || '\u2014';
    const now = new Date();
    const dateStr = formData.date || now.toISOString().slice(0, 10);
    const timeStr = (formData.instructionDateTime && formData.instructionDateTime.length >= 16)
      ? formData.instructionDateTime.slice(11, 16)
      : (formData.timeFirstContactWithClient || formData.timeArrival || pad2(now.getHours()) + ':' + pad2(now.getMinutes()));
    const leftParts = [];
    if (formData._formType === 'telephone') leftParts.push('<span class="context-invb-badge">INVB Tel</span>');
    leftParts.push('<span><span class="context-label">Client:</span>' + esc(clientName) + '</span>');
    leftParts.push('<span><span class="context-label">Station:</span>' + esc(station) + '</span>');
    if (formData.custodyNumber) leftParts.push('<span><span class="context-label">Custody:</span>' + esc(formData.custodyNumber) + '</span>');
    if (formData.ufn) leftParts.push('<span><span class="context-label">UFN:</span>' + esc(formData.ufn) + '</span>');
    if (formData.timeArrival && formData.date) {
      const dur = getAttendanceDuration();
      if (dur) {
        if (formData.timeDeparture) {
          leftParts.push('<span class="duration-tag">' + dur + ' on site (departed ' + esc(formData.timeDeparture) + ')</span>');
        } else {
          leftParts.push('<span class="duration-tag">' + dur + ' at station</span>');
        }
      }
    }
    const paceHtml = getPaceClockHtml();
    if (paceHtml) leftParts.push(paceHtml);
    const rightHtml = '<span class="context-right">' + esc(poshDateTime(dateStr, timeStr)) + '</span>';
    bar.innerHTML = '<span class="context-left">' + leftParts.join('') + '</span>' + rightHtml;
  }

  function getAttendanceDuration() {
    if (!formData.timeArrival) return '';
    const [ah, am] = formData.timeArrival.split(':').map(Number);
    const now = new Date();
    const arrMins = ah * 60 + am;
    const nowMins = now.getHours() * 60 + now.getMinutes();
    let diff = nowMins - arrMins;
    if (diff < 0) diff += 1440;
    if (formData.timeDeparture) {
      const [dh, dm] = formData.timeDeparture.split(':').map(Number);
      diff = (dh * 60 + dm) - arrMins;
      if (diff < 0) diff += 1440;
    }
    const hrs = Math.floor(diff / 60);
    const mins = diff % 60;
    return hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + 'm';
  }

  function getPaceClockHtml() {
    if (!formData.relevantTime || !formData.dateOfArrest) return '';
    const [rh, rm] = formData.relevantTime.split(':').map(Number);
    const arrestDate = new Date(formData.dateOfArrest + 'T' + pad2(rh) + ':' + pad2(rm) + ':00');
    if (isNaN(arrestDate.getTime())) return '';
    const now = new Date();
    const elapsedMs = now - arrestDate;
    const elapsedHrs = elapsedMs / 3600000;
    if (elapsedHrs < 0 || elapsedHrs > 96) return '';
    const remainHrs = 24 - elapsedHrs;
    const eH = Math.floor(elapsedHrs);
    const eM = Math.floor((elapsedHrs - eH) * 60);
    let review = '';
    if (elapsedHrs < 6) review = '<span class="pace-review">1st review in ' + Math.floor((6 - elapsedHrs) * 60) + 'm</span>';
    else if (elapsedHrs < 15) review = '<span class="pace-review">2nd review in ' + Math.floor((15 - elapsedHrs) * 60) + 'm</span>';
    else if (elapsedHrs < 24) review = '<span class="pace-review">3rd review in ' + Math.floor((24 - elapsedHrs) * 60) + 'm</span>';
    const colour = remainHrs < 2 ? 'pace-elapsed' : 'pace-ok';
    return '<span class="pace-clock">' +
      '<span class="' + colour + '">PACE: ' + eH + 'h ' + eM + 'm</span>' +
      (remainHrs > 0 ? '<span class="pace-elapsed">' + Math.floor(remainHrs) + 'h ' + Math.floor((remainHrs % 1) * 60) + 'm left</span>' : '<span class="pace-elapsed">EXPIRED</span>') +
      (review || '') +
      '</span>';
  }

  function startPaceClock() {
    stopPaceClock();
    paceTimer = setInterval(() => updateContextBar(), 60000);
  }

  function stopPaceClock() {
    if (paceTimer) { clearInterval(paceTimer); paceTimer = null; }
  }

  function renderForm(data) {
    const form = document.getElementById('attendance-form');
    if (!form) return;
    form.innerHTML = '';

    // Backward-compat: older builds stored OIC email in the old force/collar field.
    if (!formData.oicEmail && formData.oicForceNo && String(formData.oicForceNo).indexOf('@') >= 0) {
      formData.oicEmail = formData.oicForceNo;
    }

    /* Stand-alone section mode (Admin, Consents, Third Party, Authorities, Comms, Supervisor, LAA Declaration) */
    if (currentStandaloneSectionId && activeFormSections === formSections) {
      const sec = standaloneSections.find(s => s.id === currentStandaloneSectionId);
      if (sec) {
        const backBar = document.getElementById('standalone-back-bar');
        const idxBar = document.getElementById('section-index-bar');
        const progBar = document.getElementById('section-progress-bar');
        const progBar2 = document.getElementById('section-progress-bar-2');
        if (backBar) backBar.classList.remove('hidden');
        if (idxBar) idxBar.style.display = 'none';
        if (progBar) progBar.style.display = 'none';
        if (progBar2) progBar2.style.display = 'none';
        document.getElementById('form-prev')?.classList.add('hidden');
        document.getElementById('form-next')?.classList.add('hidden');
        setFormTitle(sec.title);

        const section = document.createElement('div');
        section.className = 'form-section active';
        section.dataset.sectionId = sec.id;
        if (sec.hasDeclarationText && refData.laaDeclarationText) {
          const decl = document.createElement('div');
          decl.className = 'declaration-box';
          decl.innerHTML = '<h3>Applicant\'s Declaration</h3><p class="declaration-text">' + esc(refData.laaDeclarationText) + '</p>';
          if (refData.privacyNoticeText) decl.innerHTML += '<p class="privacy-text">' + esc(refData.privacyNoticeText) + '</p>';
          section.appendChild(decl);
        }
        const grid = document.createElement('div');
        grid.className = 'form-row-2col';
        (sec.fields || []).forEach(f => renderField(f, data, grid, section));
        if (grid.children.length) section.appendChild(grid);
        if (sec.id === 'adminBilling') {
          const ufnInp = section.querySelector('[data-field="ufn"]');
          if (ufnInp) {
            const sugBtn = document.createElement('button');
            sugBtn.type = 'button';
            sugBtn.className = 'btn-small';
            sugBtn.style.marginTop = '4px';
            sugBtn.textContent = 'Suggest UFN';
            sugBtn.addEventListener('click', () => {
              const d = formData.date || formData.instructionDateTime?.slice(0, 10);
              if (!d) { showToast('Set a date first (section 1)', 'error'); return; }
              const parts = d.split('-');
              const ddmmyy = parts[2] + parts[1] + parts[0].slice(2);
              const ref = formData.ourFileNumber || formData.fileReference || '001';
              const nnn = String(ref).replace(/\D/g, '').slice(-3).padStart(3, '0');
              ufnInp.value = ddmmyy + '/' + nnn;
              formData.ufn = ufnInp.value;
              ufnInp.dispatchEvent(new Event('change'));
            });
            ufnInp.parentElement?.appendChild(sugBtn);
          }
        }
        if (sec.extraActions) {
          const actions = document.createElement('div');
          actions.className = 'form-actions';
          actions.innerHTML = '<button type="button" class="btn btn-finalise" id="form-finalise">Finalise</button><button type="button" class="btn btn-accent" id="form-pdf">Export PDF to Desktop</button><button type="button" class="btn btn-accent" id="form-print">Print Attendance Note</button><button type="button" class="btn btn-accent" id="form-email">Email PDF to me</button><button type="button" class="btn btn-accent" id="form-email-solicitor">Email to solicitor</button><button type="button" class="btn btn-secondary" id="form-report-firm">Send Report to Firm</button><button type="button" class="btn btn-audit" id="form-audit-log" title="View full audit trail for this record">Audit Trail</button>';
          section.appendChild(actions);
        }
        if (sec.id === 'supervisorReview') {
          const supActions = document.createElement('div');
          supActions.className = 'form-actions';
          const supBtn = document.createElement('button');
          supBtn.type = 'button';
          supBtn.className = 'btn btn-primary';
          supBtn.id = 'form-supervisor-approve';
          supBtn.textContent = 'Record Supervisor Approval';
          supActions.appendChild(supBtn);
          section.appendChild(supActions);
        }
        form.appendChild(section);
        applyConditionalVisibility();
        updateContextBar();
        updateFormBarVisibility();
        const timeAndCalcFields = ['timeSetOff','timeArrival','timeDeparture','timeOfficeHome','waitingTimeStart','waitingTimeEnd','weekendBankHoliday'];
        const sharedClientFields = ['forename','surname','middleName','dob','title','address1','address2','address3','city','county','postCode','gender','nationality','nationalityOther','clientPhone','clientEmail'];
        form.querySelectorAll('select, input, textarea').forEach(el => {
          el.addEventListener('change', () => { collectCurrentData(); applyConditionalVisibility(); updateContextBar(); quietSave(); });
          el.addEventListener('blur', () => { collectCurrentData(); quietSave(); });
        });
        startAutoSave();
        return;
      }
    }

    document.getElementById('standalone-back-bar')?.classList.add('hidden');
    document.getElementById('section-index-bar').style.display = '';
    document.getElementById('section-progress-bar').style.display = '';
    var pb2 = document.getElementById('section-progress-bar-2');
    if (pb2) pb2.style.display = '';
    document.getElementById('form-prev')?.classList.remove('hidden');
    document.getElementById('form-next')?.classList.remove('hidden');

    activeFormSections.forEach((sec, secIdx) => {
      const section = document.createElement('div');
      section.className = 'form-section' + (secIdx === currentSectionIdx ? ' active' : '');
      section.dataset.secIdx = secIdx;
      section.dataset.sectionId = sec.id || '';
      if (sec.id === 'supervisorReview' && !isSupervisorSectionEnabled()) {
        section.style.display = 'none';
      }
      /* Date/time bar removed -- now shown in context bar only */

      /* Declaration text */
      if (sec.hasDeclarationText && refData.laaDeclarationText) {
        const telNote = document.createElement('p');
        telNote.className = 'declaration-tel-note';
        telNote.style.fontSize = '12px'; telNote.style.color = '#64748b'; telNote.style.marginBottom = '8px';
        telNote.textContent = 'For telephone advice only: client may sign declaration later if not present; note on file if declaration is to follow.';
        telNote.dataset.showIfField = 'workType';
        telNote.dataset.showIfValue = 'Police Station Telephone Attendance';
        telNote.dataset.showIfOrField = 'sufficientBenefitTest';
        telNote.dataset.showIfOrValue = 'Telephone advice only';
        telNote.style.display = 'none';
        section.appendChild(telNote);
        const decl = document.createElement('div');
        decl.className = 'declaration-box';
        decl.innerHTML = '<h3>Applicant\'s Declaration</h3><p class="declaration-text">' + esc(refData.laaDeclarationText) + '</p>';
        if (refData.privacyNoticeText) {
          decl.innerHTML += '<p class="privacy-text">' + esc(refData.privacyNoticeText) + '</p>';
        }
        section.appendChild(decl);
      }

      /* Checklist (optionally grouped) */
      if (sec.checklist) {
        const cl = document.createElement('div');
        cl.className = 'checklist-group consultation-checklist';
        const header = document.createElement('div');
        header.className = 'checklist-header';
        header.innerHTML = '<p class="checklist-label">Tick all that apply:</p>';
        cl.appendChild(header);
        const groups = {};
        sec.checklist.forEach(c => {
          const g = c.group || '';
          if (!groups[g]) groups[g] = [];
          groups[g].push(c);
        });
        const groupOrder = ['Conflict & independence', 'Advice to client', 'Client understanding', 'Custody record & disclosure', ''];
        groupOrder.forEach(grpLabel => {
          const items = groups[grpLabel];
          if (!items || !items.length) return;
          if (grpLabel) {
            const subhead = document.createElement('div');
            subhead.className = 'checklist-subhead';
            subhead.textContent = grpLabel;
            cl.appendChild(subhead);
          }
          const row = document.createElement('div');
          row.className = 'checklist-row';
          items.forEach(c => {
            const wrap = document.createElement('label');
            wrap.className = 'checklist-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.name = c.key; cb.checked = !!data[c.key];
            wrap.appendChild(cb); wrap.append(' ' + c.label);
            row.appendChild(wrap);
          });
          cl.appendChild(row);
        });
        section.appendChild(cl);
      }

      /* Main fields grid */
      const grid = document.createElement('div');
      grid.className = 'form-row-2col';
      (sec.fields || []).forEach(f => renderField(f, data, grid, section));
      if (grid.children.length) section.appendChild(grid);


      /* Advice checklist (grouped) */
      if (sec.adviceChecklist) {
        const al = document.createElement('div');
        al.className = 'checklist-group advice-checklist';
        const header2 = document.createElement('div');
        header2.className = 'checklist-header';
        header2.innerHTML = '<p class="checklist-label">Advice Given (tick all that apply):</p>';
        al.appendChild(header2);
        const adviceGroups = {};
        sec.adviceChecklist.forEach(c => {
          const g = c.group || '';
          if (!adviceGroups[g]) adviceGroups[g] = [];
          adviceGroups[g].push(c);
        });
        const adviceGroupOrder = ['Rights & caution', 'Interview', 'Procedures & other', ''];
        adviceGroupOrder.forEach(grpLabel => {
          const items = adviceGroups[grpLabel];
          if (!items || !items.length) return;
          if (grpLabel) {
            const subhead = document.createElement('div');
            subhead.className = 'checklist-subhead';
            subhead.textContent = grpLabel;
            al.appendChild(subhead);
          }
          const row = document.createElement('div');
          row.className = 'checklist-row';
          items.forEach(c => {
            const wrap = document.createElement('label');
            wrap.className = 'checklist-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.name = c.key; cb.checked = !!data[c.key];
            wrap.appendChild(cb); wrap.append(' ' + c.label);
            row.appendChild(wrap);
          });
          al.appendChild(row);
        });
        section.appendChild(al);
      }

      /* Extra fields */
      if (sec.extraFields) {
        const grid2 = document.createElement('div');
        grid2.className = 'form-row-2col';
        sec.extraFields.forEach(f => renderField(f, data, grid2, section));
        if (grid2.children.length) section.appendChild(grid2);
      }

      /* Calc panel */
      if (sec.hasCalcPanel) {
        const cp = document.createElement('div');
        cp.id = 'calc-panel';
        cp.className = 'calc-panel';
        section.appendChild(cp);
      }

      /* Common offences picker for offences section */
      if (sec.id === 'offences') {
        renderOffencePicker(section);
      }

      /* UFN auto-suggestion on admin section */
      if (sec.id === 'adminBilling') {
        const ufnInp = section.querySelector('[data-field="ufn"]');
        if (ufnInp) {
          const sugBtn = document.createElement('button');
          sugBtn.type = 'button';
          sugBtn.className = 'btn-small';
          sugBtn.style.marginTop = '4px';
          sugBtn.textContent = 'Suggest UFN';
          sugBtn.addEventListener('click', () => {
            const d = formData.date || formData.instructionDateTime?.slice(0, 10);
            if (!d) { showToast('Set a date first (section 1)', 'error'); return; }
            const parts = d.split('-');
            const ddmmyy = parts[2] + parts[1] + parts[0].slice(2);
            const ref = formData.ourFileNumber || formData.fileReference || '001';
            const nnn = String(ref).replace(/\D/g, '').slice(-3).padStart(3, '0');
            const suggestedUfn = ddmmyy + '/' + nnn;
            ufnInp.value = suggestedUfn;
            formData.ufn = suggestedUfn;
            ufnInp.dispatchEvent(new Event('change'));
          });
          ufnInp.parentElement?.appendChild(sugBtn);
        }
      }

      /* Further attendance button on outcome section */
      if (sec.id === 'outcome') {
        const faWrap = document.createElement('div');
        faWrap.id = 'further-attendance-wrap';
        faWrap.style.display = 'none';
        faWrap.style.marginTop = '1rem';
        const faBtn = document.createElement('button');
        faBtn.type = 'button';
        faBtn.className = 'btn btn-primary';
        faBtn.textContent = 'Create Follow-up Attendance';
        faBtn.addEventListener('click', () => {
          collectCurrentData();
          const src = Object.assign({}, formData);
          const copyKeys = ['surname','forename','middleName','firmId','firmName','firmLaaAccount','firmContactName','firmContactPhone','firmContactEmail',
            'policeStationId','policeStationName','policeStationCode','schemeId','custodyNumber','dsccRef','oicName','oicForceNo','oicPhone',
            'offenceSummary','offence1Details','matterTypeCode','sourceOfReferral'];
          formData = {};
          currentSectionIdx = 0;
          currentAttendanceId = null;
          copyKeys.forEach(k => { if (src[k]) formData[k] = src[k]; });
          formData.workType = 'Further Police Station Attendance';
          formData.caseStatus = 'Existing case';
          formData.clientType = 'Existing';
          prefillDefaults();
          renderForm(formData);
        });
        faWrap.appendChild(faBtn);
        section.appendChild(faWrap);
      }

      /* Multi-interview */
      if (sec.multiInterview) {
        renderNoCommentButton(section);
        renderMultiInterview(section, data, sec);
      }

      /* Attachments for relevant sections */
      if (['custody', 'disclosure', 'interview', 'injuriesAppearance'].includes(sec.id)) {
        const photoWrap = document.createElement('div');
        photoWrap.className = 'photo-attach-area';
        photoWrap.innerHTML = '<h4 class="section-heading" style="margin-top:1rem;cursor:default;">Attachments</h4>';
        const thumbs = document.createElement('div');
        thumbs.className = 'photo-thumbs';
        thumbs.id = 'photo-thumbs-' + sec.id;
        photoWrap.appendChild(thumbs);
        const attachBtn = document.createElement('button');
        attachBtn.type = 'button';
        attachBtn.className = 'btn btn-secondary';
        attachBtn.textContent = '+ Add attachment';
        attachBtn.addEventListener('click', () => {
          if (!window.api || !window.api.pickImage) return;
          window.api.pickImage().then(result => {
            if (!result || result.error) { if (result && result.error) showToast(result.error, 'error'); return; }
            if (!formData.photos) formData.photos = {};
            if (!formData.photos[sec.id]) formData.photos[sec.id] = [];
            formData.photos[sec.id].push({ dataUrl: result.dataUrl, name: result.name });
            renderPhotoThumbs(sec.id);
            quietSave();
          });
        });
        photoWrap.appendChild(attachBtn);
        section.appendChild(photoWrap);
        renderPhotoThumbs(sec.id);
      }

      /* Extra actions (Finalise, PDF, Email) */
      if (sec.extraActions) {
        const actions = document.createElement('div');
        actions.className = 'form-actions';
        actions.innerHTML =
          '<button type="button" class="btn btn-finalise" id="form-finalise">Finalise</button>' +
          '<button type="button" class="btn btn-accent" id="form-pdf">Export PDF to Desktop</button>' +
          '<button type="button" class="btn btn-accent" id="form-print">Print Attendance Note</button>' +
          '<button type="button" class="btn btn-accent" id="form-email">Email PDF to me</button>' +
          '<button type="button" class="btn btn-accent" id="form-email-solicitor">Email to solicitor</button>' +
          '<button type="button" class="btn btn-secondary" id="form-report-firm">Send Report to Firm</button>' +
          '<button type="button" class="btn btn-audit" id="form-audit-log" title="View full audit trail for this record">Audit Trail</button>';
        section.appendChild(actions);
      }

      /* Section 9: Finalise and Archive actions at the natural end of the record */
      if (sec.id === 'timeRecording') {
        const endActions = document.createElement('div');
        endActions.className = 'form-actions form-end-actions';
        endActions.innerHTML =
          '<button type="button" class="btn btn-finalise" id="form-finalise-bar" style="display:none;">Attendance Finished &mdash; Finalise</button>' +
          '<button type="button" class="btn btn-secondary" id="form-archive-btn" style="display:none;">Archive Record</button>' +
          '<button type="button" class="btn btn-secondary" id="form-unarchive-btn" style="display:none;">Unarchive Record</button>';
        section.appendChild(endActions);
      }

      /* Supervisor section action */
      if (sec.id === 'supervisorReview') {
        const supActions = document.createElement('div');
        supActions.className = 'form-actions';
        const supBtn = document.createElement('button');
        supBtn.type = 'button';
        supBtn.className = 'btn btn-primary';
        supBtn.id = 'form-supervisor-approve';
        supBtn.textContent = 'Record Supervisor Approval';
        supActions.appendChild(supBtn);
        section.appendChild(supActions);
      }

      form.appendChild(section);
    });

    setFormTitle(activeFormSections[currentSectionIdx].title);
    buildSectionsIndex();
    applyConditionalVisibility();
    updateContextBar();
    updateFormBarVisibility();

    /* Form action buttons (Finalise, PDF, Email, Report, Audit, Supervisor) are handled by delegated listener in init */

    const timeAndCalcFields = ['timeSetOff','timeArrival','timeDeparture','timeOfficeHome','waitingTimeStart','waitingTimeEnd','weekendBankHoliday'];
    const sharedClientFields = ['forename','surname','middleName','dob','title','address1','address2','address3','city','county','postCode','gender','nationality','nationalityOther','clientPhone','clientEmail'];
    form.querySelectorAll('select, input, textarea').forEach(el => {
      el.addEventListener('change', () => {
        collectCurrentData();
        const field = el.dataset.field;
        if (field && sharedClientFields.includes(field)) {
          setFieldValueSilent(field, el.value);
        }
        applyConditionalVisibility();
        updateContextBar();
        if (field === 'instructionDateTime' && el.value) {
          formData.date = el.value.slice(0, 10);
          const dow = new Date(formData.date).getDay();
          const isWE = dow === 0 || dow === 6;
          const isBH = UK_BANK_HOLIDAYS.includes(formData.date);
          setFieldValue('weekendBankHoliday', (isWE || isBH) ? 'Yes' : 'No');
        }
        if (field === 'outcomeDecision') {
          applyConditionalVisibility();
          if (formData.outcomeDecision === 'Bail without charge' && (!formData.bailReturnStationName || !formData.bailReturnStationCode)) {
            if (formData.policeStationName) { formData.bailReturnStationName = formData.policeStationName; setFieldValueSilent('bailReturnStationName', formData.policeStationName); }
            if (formData.schemeId) { formData.bailReturnStationCode = formData.schemeId; setFieldValueSilent('bailReturnStationCode', formData.schemeId); }
          }
        }
        if (timeAndCalcFields.includes(field)) { autoCalcTimes(); }
        else if (['travelSocial','travelUnsocial','waitingSocial','waitingUnsocial','adviceSocial','adviceUnsocial','milesClaimable'].includes(field)) recalcTotal();
        if (field === 'timeDetentionAuthorised') { setFieldValue('relevantTime', el.value || ''); calcReviewTimes(); }
        if (field === 'relevantTime') { calcReviewTimes(); }
        updateProgressBar();
        quietSave();
      });
      el.addEventListener('blur', () => {
        collectCurrentData();
        const field = el.dataset.field;
        if (field && sharedClientFields.includes(field)) {
          setFieldValueSilent(field, el.value);
        }
        updateProgressBar();
        quietSave();
      });
    });

    calcReviewTimes();
    startAutoSave();
    startPaceClock();
    updateProgressBar();
  }

  function renderField(f, data, grid) {
    if (f.type === 'sectionHeading') {
      const h = document.createElement('h3');
      h.className = 'section-heading';
      h.textContent = f.label;
      h.addEventListener('click', () => {
        h.classList.toggle('collapsed');
        let sib = h.nextElementSibling;
        while (sib && !sib.classList.contains('section-heading')) {
          sib.classList.toggle('collapsed');
          sib.style.display = h.classList.contains('collapsed') ? 'none' : '';
          sib = sib.nextElementSibling;
        }
      });
      grid.appendChild(h);
      return;
    }
    if (f.type === 'sectionNote') {
      const p = document.createElement('p');
      p.className = 'section-note';
      p.textContent = f.label;
      grid.appendChild(p);
      return;
    }
    if (f.type === 'actionButton') {
      const wrap = document.createElement('div');
      wrap.className = 'form-group action-btn-group';
      wrap.style.gridColumn = '1 / -1';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.textContent = f.label;
      btn.addEventListener('click', () => {
        if (f.action === 'generateConflictCert') generateConflictCert();
        else if (f.action === 'generateClientInstructions') generateClientInstructionsDoc();
        else if (f.action === 'generatePreparedStatement') generatePreparedStatement();
        else if (f.action === 'convertToAttendance') convertTelephoneToAttendance();
      });
      wrap.appendChild(btn);
      grid.appendChild(wrap);
      return;
    }
    if (f.type === 'nameRow') {
      const wrap = document.createElement('div');
      wrap.className = 'form-group name-row-group';
      wrap.style.gridColumn = '1 / -1';
      const topLabel = document.createElement('label');
      topLabel.textContent = f.label;
      wrap.appendChild(topLabel);
      const row = document.createElement('div');
      row.className = 'name-row';
      (f.fields || []).forEach(function (sub) {
        const sg = document.createElement('div');
        sg.className = 'name-row-field' + (sub.key === 'middleName' ? ' name-row-middle' : '');
        const sl = document.createElement('label');
        sl.className = 'name-row-sublabel';
        sl.textContent = sub.label;
        sg.appendChild(sl);
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.name = sub.key;
        inp.dataset.field = sub.key;
        if (sub.placeholder) inp.placeholder = sub.placeholder;
        if (data[sub.key]) inp.value = data[sub.key];
        if (currentSectionIdx === 0 || currentSectionIdx === 2) {
          inp.addEventListener('input', function () { triggerClientLookup(this); });
          inp.addEventListener('blur', function () { setTimeout(hideClientDropdown, 150); });
          inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideClientDropdown(); });
        }
        if (REQUIRED_FIELD_KEYS.includes(sub.key)) {
          inp.addEventListener('blur', function () {
            if (!(inp.value || '').trim()) inp.classList.add('input-error');
            else inp.classList.remove('input-error');
          });
          inp.addEventListener('input', function () {
            if ((inp.value || '').trim()) inp.classList.remove('input-error');
          });
        }
        sg.appendChild(inp);
        row.appendChild(sg);
      });
      wrap.appendChild(row);
      grid.appendChild(wrap);
      return;
    }
    if (f.type === 'multiDisbursement') {
      const wrap = document.createElement('div');
      wrap.className = 'form-group';
      wrap.style.gridColumn = '1 / -1';
      const lbl = document.createElement('label'); lbl.textContent = f.label; lbl.style.fontWeight = '700'; wrap.appendChild(lbl);
      const container = document.createElement('div');
      container.id = 'multi-disbursement-container';
      if (!formData.disbursements || !formData.disbursements.length) formData.disbursements = [{ description: '', amount: '', vatTreatment: 'No VAT' }];
      function renderDisbursements() {
        container.innerHTML = '';
        formData.disbursements.forEach((dis, idx) => {
          const block = document.createElement('div');
          block.className = 'disbursement-block';
          block.innerHTML = '<div class="disbursement-heading"><span>Disbursement ' + (idx + 1) + '</span>' + (idx > 0 ? '<button type="button" class="btn-small iv-remove" data-didx="' + idx + '">Remove</button>' : '') + '</div>';
          const row = document.createElement('div');
          row.className = 'form-row-2col';
          var descWrap = document.createElement('div'); descWrap.className = 'form-group';
          var descLbl = document.createElement('label'); descLbl.textContent = 'Category'; descWrap.appendChild(descLbl);
          var descSel = document.createElement('select'); descSel.className = 'form-input';
          var disbCats = ['Interpreter','Medical Report','Mileage','Travel (public transport)','Photocopying','Telephone calls','Other'];
          var catOpt0 = document.createElement('option'); catOpt0.value = ''; catOpt0.textContent = '-- Select --'; descSel.appendChild(catOpt0);
          disbCats.forEach(function(c) { var o = document.createElement('option'); o.value = c; o.textContent = c; if (dis.description === c) o.selected = true; descSel.appendChild(o); });
          if (dis.description && !disbCats.includes(dis.description)) { descSel.value = 'Other'; }
          descSel.addEventListener('change', function () { formData.disbursements[idx].description = this.value; });
          descWrap.appendChild(descSel);
          if (dis.description === 'Other' || (dis.description && !disbCats.includes(dis.description))) {
            var otherInp = document.createElement('input'); otherInp.type = 'text'; otherInp.className = 'form-input'; otherInp.placeholder = 'Describe...';
            otherInp.value = dis.descriptionOther || (disbCats.includes(dis.description) ? '' : dis.description);
            otherInp.style.marginTop = '0.3rem';
            otherInp.addEventListener('input', function () { formData.disbursements[idx].descriptionOther = this.value; });
            descWrap.appendChild(otherInp);
          }
          descSel.addEventListener('change', function () {
            formData.disbursements[idx].description = this.value;
            renderDisbursements();
          });
          row.appendChild(descWrap);
          var amtWrap = document.createElement('div'); amtWrap.className = 'form-group';
          var amtLbl = document.createElement('label'); amtLbl.textContent = 'Amount (\u00A3)'; amtWrap.appendChild(amtLbl);
          var amtInp = document.createElement('input'); amtInp.type = 'number'; amtInp.className = 'form-input'; amtInp.value = dis.amount || ''; amtInp.placeholder = '0.00'; amtInp.step = '0.01';
          amtInp.addEventListener('input', function () { formData.disbursements[idx].amount = this.value; });
          amtWrap.appendChild(amtInp); row.appendChild(amtWrap);
          var vatWrap = document.createElement('div'); vatWrap.className = 'form-group';
          var vatLbl = document.createElement('label'); vatLbl.textContent = 'VAT Treatment'; vatWrap.appendChild(vatLbl);
          var vatSel = document.createElement('select'); vatSel.className = 'form-input';
          ['Inclusive of VAT', 'Plus VAT', 'No VAT'].forEach(function (o) { var opt = document.createElement('option'); opt.value = o; opt.textContent = o; if (dis.vatTreatment === o) opt.selected = true; vatSel.appendChild(opt); });
          vatSel.addEventListener('change', function () { formData.disbursements[idx].vatTreatment = this.value; });
          vatWrap.appendChild(vatSel); row.appendChild(vatWrap);
          block.appendChild(row);
          block.querySelector('.iv-remove')?.addEventListener('click', function () { formData.disbursements.splice(idx, 1); renderDisbursements(); });
          container.appendChild(block);
        });
        var addBtn = document.createElement('button');
        addBtn.type = 'button'; addBtn.className = 'btn-add-disbursement'; addBtn.textContent = '+ Add Disbursement';
        addBtn.addEventListener('click', function () { formData.disbursements.push({ description: '', amount: '', vatTreatment: 'No VAT' }); renderDisbursements(); });
        container.appendChild(addBtn);
      }
      renderDisbursements();
      wrap.appendChild(container);
      grid.appendChild(wrap);
      return;
    }
    if (f.type === 'multiPaceSearch') {
      const wrap = document.createElement('div');
      wrap.className = 'form-group';
      wrap.style.gridColumn = '1 / -1';
      const lbl = document.createElement('label');
      lbl.textContent = f.label;
      lbl.style.fontWeight = '700';
      wrap.appendChild(lbl);
      const container = document.createElement('div');
      container.id = 'multi-pace-search-container';
      const searchTypes = ['s18 (premises)','s32 (on arrest)','s54 (intimate)','Person search','Property search','Vehicle search','Other'];
      if (!formData.paceSearches || !formData.paceSearches.length) formData.paceSearches = [{ searchType: '', whatFound: '' }];
      function renderPaceSearches() {
        container.innerHTML = '';
        formData.paceSearches.forEach((ent, idx) => {
          const block = document.createElement('div');
          block.className = 'pace-search-block evidence-block';
          block.innerHTML = '<div class="disbursement-heading"><span>Search ' + (idx + 1) + '</span>' + (idx > 0 ? '<button type="button" class="btn-small iv-remove">Remove</button>' : '') + '</div>';
          const row = document.createElement('div');
          row.className = 'form-row-2col';
          const typeWrap = document.createElement('div');
          typeWrap.className = 'form-group';
          const typeLbl = document.createElement('label');
          typeLbl.textContent = 'Type of search';
          typeWrap.appendChild(typeLbl);
          const typeSel = document.createElement('select');
          typeSel.className = 'form-input pace-search-type';
          const opt0 = document.createElement('option');
          opt0.value = '';
          opt0.textContent = '-- Select --';
          typeSel.appendChild(opt0);
          searchTypes.forEach(function (t) {
            const o = document.createElement('option');
            o.value = t;
            o.textContent = t;
            if (ent.searchType === t) o.selected = true;
            typeSel.appendChild(o);
          });
          typeSel.addEventListener('change', function () { formData.paceSearches[idx].searchType = this.value; });
          typeWrap.appendChild(typeSel);
          row.appendChild(typeWrap);
          const foundWrap = document.createElement('div');
          foundWrap.className = 'form-group';
          foundWrap.style.gridColumn = '1 / -1';
          const foundLbl = document.createElement('label');
          foundLbl.textContent = 'What was found';
          foundWrap.appendChild(foundLbl);
          const foundInp = document.createElement('input');
          foundInp.type = 'text';
          foundInp.className = 'form-input';
          foundInp.placeholder = 'e.g. Mobile phone, keys, cash';
          foundInp.value = ent.whatFound || '';
          foundInp.addEventListener('input', function () { formData.paceSearches[idx].whatFound = this.value; });
          foundWrap.appendChild(foundInp);
          row.appendChild(foundWrap);
          block.appendChild(row);
          block.querySelector('.iv-remove')?.addEventListener('click', function () { formData.paceSearches.splice(idx, 1); renderPaceSearches(); });
          container.appendChild(block);
        });
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn-add-disbursement';
        addBtn.textContent = '+ Add search';
        addBtn.addEventListener('click', function () { formData.paceSearches.push({ searchType: '', whatFound: '' }); renderPaceSearches(); });
        container.appendChild(addBtn);
      }
      renderPaceSearches();
      wrap.appendChild(container);
      grid.appendChild(wrap);
      return;
    }
    if (f.type === 'multiForensicSample') {
      const wrap = document.createElement('div');
      wrap.className = 'form-group';
      wrap.style.gridColumn = '1 / -1';
      const lbl = document.createElement('label');
      lbl.textContent = f.label;
      lbl.style.fontWeight = '700';
      wrap.appendChild(lbl);
      const container = document.createElement('div');
      container.id = 'multi-forensic-sample-container';
      const sampleTypes = ['DNA / mouth swab','Blood','Saliva','Fingerprints','Footwear impression','Hair','Other'];
      const whatDoneOptions = ['Taken','Refused','Done','Not applicable','Pending'];
      if (!formData.forensicSamples || !formData.forensicSamples.length) formData.forensicSamples = [{ sampleType: '', whatDone: '', notes: '' }];
      function renderForensicSamples() {
        container.innerHTML = '';
        formData.forensicSamples.forEach((ent, idx) => {
          const block = document.createElement('div');
          block.className = 'forensic-sample-block evidence-block';
          block.innerHTML = '<div class="disbursement-heading"><span>Sample ' + (idx + 1) + '</span>' + (idx > 0 ? '<button type="button" class="btn-small iv-remove">Remove</button>' : '') + '</div>';
          const row = document.createElement('div');
          row.className = 'form-row-2col';
          const typeWrap = document.createElement('div');
          typeWrap.className = 'form-group';
          const typeLbl = document.createElement('label');
          typeLbl.textContent = 'Type of sample';
          typeWrap.appendChild(typeLbl);
          const typeSel = document.createElement('select');
          typeSel.className = 'form-input forensic-sample-type';
          const opt0 = document.createElement('option');
          opt0.value = '';
          opt0.textContent = '-- Select --';
          typeSel.appendChild(opt0);
          sampleTypes.forEach(function (t) {
            const o = document.createElement('option');
            o.value = t;
            o.textContent = t;
            if (ent.sampleType === t) o.selected = true;
            typeSel.appendChild(o);
          });
          typeSel.addEventListener('change', function () { formData.forensicSamples[idx].sampleType = this.value; });
          typeWrap.appendChild(typeSel);
          row.appendChild(typeWrap);
          const doneWrap = document.createElement('div');
          doneWrap.className = 'form-group';
          const doneLbl = document.createElement('label');
          doneLbl.textContent = 'What was done';
          doneWrap.appendChild(doneLbl);
          const doneSel = document.createElement('select');
          doneSel.className = 'form-input forensic-sample-done';
          whatDoneOptions.forEach(function (w) {
            const o = document.createElement('option');
            o.value = w;
            o.textContent = w;
            if (ent.whatDone === w) o.selected = true;
            doneSel.appendChild(o);
          });
          doneSel.addEventListener('change', function () { formData.forensicSamples[idx].whatDone = this.value; });
          doneWrap.appendChild(doneSel);
          row.appendChild(doneWrap);
          const notesWrap = document.createElement('div');
          notesWrap.className = 'form-group';
          notesWrap.style.gridColumn = '1 / -1';
          const notesLbl = document.createElement('label');
          notesLbl.textContent = 'Notes (optional)';
          notesWrap.appendChild(notesLbl);
          const notesInp = document.createElement('input');
          notesInp.type = 'text';
          notesInp.className = 'form-input';
          notesInp.placeholder = 'e.g. Sent to lab, reference number';
          notesInp.value = ent.notes || '';
          notesInp.addEventListener('input', function () { formData.forensicSamples[idx].notes = this.value; });
          notesWrap.appendChild(notesInp);
          row.appendChild(notesWrap);
          block.appendChild(row);
          block.querySelector('.iv-remove')?.addEventListener('click', function () { formData.forensicSamples.splice(idx, 1); renderForensicSamples(); });
          container.appendChild(block);
        });
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn-add-disbursement';
        addBtn.textContent = '+ Add sample';
        addBtn.addEventListener('click', function () { formData.forensicSamples.push({ sampleType: '', whatDone: '', notes: '' }); renderForensicSamples(); });
        container.appendChild(addBtn);
      }
      renderForensicSamples();
      wrap.appendChild(container);
      grid.appendChild(wrap);
      return;
    }
    /* ── Multi-entry: Third Party Authority ── */
    if (f.type === 'multiThirdParty') {
      const wrap = document.createElement('div'); wrap.className = 'form-group'; wrap.style.gridColumn = '1 / -1';
      const lbl = document.createElement('label'); lbl.textContent = f.label; lbl.style.fontWeight = '700'; wrap.appendChild(lbl);
      const container = document.createElement('div'); container.className = 'multi-entry-container';
      if (!formData.thirdPartyEntries) formData.thirdPartyEntries = [];
      const relOptions = ['Spouse / Partner','Parent','Child','Sibling','Other Family Member','Friend','Employer','Landlord','Social Worker','Probation Officer','Appropriate Adult','Interpreter','Co-accused\'s Solicitor','Expert Witness','Bail Surety','Other'];
      const purposeOptions = ['Notify of arrest / detention','Collect personal belongings','Childcare / dependant arrangements','Notify employer of absence','Disclose case details','Provide bail address or surety','Act as Appropriate Adult','Provide character reference','Other'];
      const authOptions = ['','Yes','No','Verbal only'];
      const contactedOptions = ['','Not yet','Yes','Unable to reach'];
      function renderThirdParty() {
        container.innerHTML = '';
        formData.thirdPartyEntries.forEach(function(ent, idx) {
          var block = document.createElement('div'); block.className = 'evidence-block';
          block.innerHTML = '<div class="disbursement-heading"><span>Third Party ' + (idx + 1) + '</span><button type="button" class="btn-small iv-remove">Remove</button></div>';
          var row = document.createElement('div'); row.className = 'form-row-2col';
          function addField(key, label, type, opts) {
            var fw = document.createElement('div'); fw.className = 'form-group';
            if (opts && opts.full) fw.style.gridColumn = '1 / -1';
            var fl = document.createElement('label'); fl.textContent = label; fw.appendChild(fl);
            if (type === 'select') {
              var sel = document.createElement('select'); sel.className = 'form-input';
              (opts.options || []).forEach(function(o) { var op = document.createElement('option'); op.value = o; op.textContent = o || '-- Select --'; if (ent[key] === o) op.selected = true; sel.appendChild(op); });
              sel.addEventListener('change', function() { ent[key] = this.value; }); fw.appendChild(sel);
            } else if (type === 'textarea') {
              var ta = document.createElement('textarea'); ta.className = 'form-input'; ta.rows = 2; ta.value = ent[key] || '';
              if (opts && opts.placeholder) ta.placeholder = opts.placeholder;
              ta.addEventListener('input', function() { ent[key] = this.value; }); fw.appendChild(ta);
            } else {
              var inp = document.createElement('input'); inp.type = type || 'text'; inp.className = 'form-input'; inp.value = ent[key] || '';
              if (opts && opts.placeholder) inp.placeholder = opts.placeholder;
              inp.addEventListener('input', function() { ent[key] = this.value; }); fw.appendChild(inp);
            }
            row.appendChild(fw);
          }
          addField('name', 'Name', 'text', { placeholder: 'Full name of third party' });
          addField('relationship', 'Relationship', 'select', { options: [''].concat(relOptions) });
          addField('phone', 'Telephone', 'tel');
          addField('email', 'Email', 'email');
          addField('address', 'Address', 'text', { full: true, placeholder: 'Full address' });
          addField('informationToDisclose', 'Information authorised to disclose', 'textarea', { full: true, placeholder: 'e.g. Arrested for X, held at Y station, likely bail conditions' });
          addField('authorityGiven', 'Authority confirmed?', 'select', { options: authOptions });
          addField('authorityDate', 'Date authority given', 'date');
          addField('contacted', 'Contacted?', 'select', { options: contactedOptions });
          addField('contactedDate', 'Date contacted', 'date');
          addField('outcome', 'Outcome / response', 'textarea', { full: true, placeholder: 'Result of contact' });
          addField('notes', 'Notes', 'textarea', { full: true });
          block.appendChild(row);
          block.querySelector('.iv-remove').addEventListener('click', function() { formData.thirdPartyEntries.splice(idx, 1); renderThirdParty(); });
          container.appendChild(block);
        });
        var addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn-add-disbursement'; addBtn.textContent = '+ Add third party';
        addBtn.addEventListener('click', function() { formData.thirdPartyEntries.push({ name:'', relationship:'', phone:'', email:'', address:'', informationToDisclose:'', authorityGiven:'', authorityDate:'', contacted:'', contactedDate:'', outcome:'', notes:'' }); renderThirdParty(); });
        container.appendChild(addBtn);
      }
      renderThirdParty(); wrap.appendChild(container); grid.appendChild(wrap); return;
    }
    /* ── Multi-entry: Medical Authority ── */
    if (f.type === 'multiMedicalAuth') {
      const wrap = document.createElement('div'); wrap.className = 'form-group'; wrap.style.gridColumn = '1 / -1';
      const lbl = document.createElement('label'); lbl.textContent = f.label; lbl.style.fontWeight = '700'; wrap.appendChild(lbl);
      const container = document.createElement('div'); container.className = 'multi-entry-container';
      if (!formData.medicalAuthorities) formData.medicalAuthorities = [];
      const providerTypes = ['GP / Family Doctor','Hospital / A&E','Mental Health Team (CMHT)','Psychiatrist / Psychologist','Drug & Alcohol Service','FME / Custody Healthcare','Dentist','Other'];
      const scopeOptions = ['Full medical records','Specific condition records','Mental health records','Medication history','Fitness to detain / interview report','Psychiatric assessment','Drug / alcohol treatment records','Other'];
      function renderMedAuth() {
        container.innerHTML = '';
        formData.medicalAuthorities.forEach(function(ent, idx) {
          var block = document.createElement('div'); block.className = 'evidence-block';
          block.innerHTML = '<div class="disbursement-heading"><span>Medical Authority ' + (idx + 1) + '</span><button type="button" class="btn-small iv-remove">Remove</button></div>';
          var row = document.createElement('div'); row.className = 'form-row-2col';
          function addField(key, label, type, opts) {
            var fw = document.createElement('div'); fw.className = 'form-group';
            if (opts && opts.full) fw.style.gridColumn = '1 / -1';
            var fl = document.createElement('label'); fl.textContent = label; fw.appendChild(fl);
            if (type === 'select') {
              var sel = document.createElement('select'); sel.className = 'form-input';
              (opts.options || []).forEach(function(o) { var op = document.createElement('option'); op.value = o; op.textContent = o || '-- Select --'; if (ent[key] === o) op.selected = true; sel.appendChild(op); });
              sel.addEventListener('change', function() { ent[key] = this.value; }); fw.appendChild(sel);
            } else if (type === 'textarea') {
              var ta = document.createElement('textarea'); ta.className = 'form-input'; ta.rows = 2; ta.value = ent[key] || '';
              if (opts && opts.placeholder) ta.placeholder = opts.placeholder;
              ta.addEventListener('input', function() { ent[key] = this.value; }); fw.appendChild(ta);
            } else {
              var inp = document.createElement('input'); inp.type = type || 'text'; inp.className = 'form-input'; inp.value = ent[key] || '';
              if (opts && opts.placeholder) inp.placeholder = opts.placeholder;
              inp.addEventListener('input', function() { ent[key] = this.value; }); fw.appendChild(inp);
            }
            row.appendChild(fw);
          }
          addField('providerType', 'Provider type', 'select', { options: [''].concat(providerTypes) });
          addField('providerName', 'Name of practitioner / service', 'text', { placeholder: 'e.g. Dr Smith' });
          addField('practice', 'Surgery / Hospital / Service', 'text', { full: true, placeholder: 'e.g. St Thomas\' Hospital' });
          addField('phone', 'Telephone', 'tel');
          addField('email', 'Email', 'email');
          addField('address', 'Address', 'text', { full: true });
          addField('scopeDetail', 'What is authorised (details)', 'textarea', { full: true, placeholder: 'e.g. Full medical records, records relating to head injury on 15/01/2025' });
          addField('authorityDate', 'Date authority given', 'date');
          addField('notes', 'Notes', 'textarea', { full: true });
          block.appendChild(row);
          block.querySelector('.iv-remove').addEventListener('click', function() { formData.medicalAuthorities.splice(idx, 1); renderMedAuth(); });
          container.appendChild(block);
        });
        var addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn-add-disbursement'; addBtn.textContent = '+ Add medical authority';
        addBtn.addEventListener('click', function() { formData.medicalAuthorities.push({ providerType:'', providerName:'', practice:'', phone:'', email:'', address:'', scopeDetail:'', authorityDate:'', notes:'' }); renderMedAuth(); });
        container.appendChild(addBtn);
      }
      renderMedAuth(); wrap.appendChild(container); grid.appendChild(wrap); return;
    }
    /* ── Multi-entry: Other Professional Authority ── */
    if (f.type === 'multiOtherAuth') {
      const wrap = document.createElement('div'); wrap.className = 'form-group'; wrap.style.gridColumn = '1 / -1';
      const lbl = document.createElement('label'); lbl.textContent = f.label; lbl.style.fontWeight = '700'; wrap.appendChild(lbl);
      const container = document.createElement('div'); container.className = 'multi-entry-container';
      if (!formData.otherAuthorities) formData.otherAuthorities = [];
      function renderOtherAuth() {
        container.innerHTML = '';
        formData.otherAuthorities.forEach(function(ent, idx) {
          var block = document.createElement('div'); block.className = 'evidence-block';
          block.innerHTML = '<div class="disbursement-heading"><span>Authority ' + (idx + 1) + '</span><button type="button" class="btn-small iv-remove">Remove</button></div>';
          var row = document.createElement('div'); row.className = 'form-row-2col';
          function addField(key, label, type, opts) {
            var fw = document.createElement('div'); fw.className = 'form-group';
            if (opts && opts.full) fw.style.gridColumn = '1 / -1';
            var fl = document.createElement('label'); fl.textContent = label; fw.appendChild(fl);
            if (type === 'textarea') {
              var ta = document.createElement('textarea'); ta.className = 'form-input'; ta.rows = 2; ta.value = ent[key] || '';
              if (opts && opts.placeholder) ta.placeholder = opts.placeholder;
              ta.addEventListener('input', function() { ent[key] = this.value; }); fw.appendChild(ta);
            } else {
              var inp = document.createElement('input'); inp.type = type || 'text'; inp.className = 'form-input'; inp.value = ent[key] || '';
              if (opts && opts.placeholder) inp.placeholder = opts.placeholder;
              inp.addEventListener('input', function() { ent[key] = this.value; }); fw.appendChild(inp);
            }
            row.appendChild(fw);
          }
          addField('organisationType', 'Organisation type', 'text', { placeholder: 'e.g. Social Services, Housing Association' });
          addField('organisationName', 'Organisation name', 'text');
          addField('contactName', 'Contact person', 'text');
          addField('phone', 'Telephone', 'tel');
          addField('email', 'Email', 'email');
          addField('scope', 'Scope of authority', 'textarea', { full: true, placeholder: 'What information is authorised' });
          addField('authorityDate', 'Date authority given', 'date');
          addField('notes', 'Notes', 'textarea', { full: true });
          block.appendChild(row);
          block.querySelector('.iv-remove').addEventListener('click', function() { formData.otherAuthorities.splice(idx, 1); renderOtherAuth(); });
          container.appendChild(block);
        });
        var addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn-add-disbursement'; addBtn.textContent = '+ Add authority';
        addBtn.addEventListener('click', function() { formData.otherAuthorities.push({ organisationType:'', organisationName:'', contactName:'', phone:'', email:'', scope:'', authorityDate:'', notes:'' }); renderOtherAuth(); });
        container.appendChild(addBtn);
      }
      renderOtherAuth(); wrap.appendChild(container); grid.appendChild(wrap); return;
    }
    /* ── Multi-entry: Communications Log ── */
    if (f.type === 'multiCommsLog') {
      const wrap = document.createElement('div'); wrap.className = 'form-group'; wrap.style.gridColumn = '1 / -1';
      const lbl = document.createElement('label'); lbl.textContent = f.label; lbl.style.fontWeight = '700'; wrap.appendChild(lbl);
      const container = document.createElement('div'); container.className = 'multi-entry-container';
      if (!formData.commsLog) formData.commsLog = [];
      const commsTypes = ['Telephone Call','Email','Text Message'];
      const dirOptions = ['Inbound','Outbound'];
      const roleOptions = ['Client','OIC','CPS','Firm','Court','Third Party','Other'];
      function renderCommsLog() {
        container.innerHTML = '';
        formData.commsLog.forEach(function(ent, idx) {
          var block = document.createElement('div'); block.className = 'evidence-block';
          block.innerHTML = '<div class="disbursement-heading"><span>Entry ' + (idx + 1) + '</span><button type="button" class="btn-small iv-remove">Remove</button></div>';
          var row = document.createElement('div'); row.className = 'form-row-2col';
          function addField(key, label, type, opts) {
            var fw = document.createElement('div'); fw.className = 'form-group';
            if (opts && opts.full) fw.style.gridColumn = '1 / -1';
            var fl = document.createElement('label'); fl.textContent = label; fw.appendChild(fl);
            if (type === 'select') {
              var sel = document.createElement('select'); sel.className = 'form-input';
              (opts.options || []).forEach(function(o) { var op = document.createElement('option'); op.value = o; op.textContent = o || '-- Select --'; if (ent[key] === o) op.selected = true; sel.appendChild(op); });
              sel.addEventListener('change', function() { ent[key] = this.value; }); fw.appendChild(sel);
            } else if (type === 'textarea') {
              var ta = document.createElement('textarea'); ta.className = 'form-input'; ta.rows = 2; ta.value = ent[key] || '';
              if (opts && opts.placeholder) ta.placeholder = opts.placeholder;
              ta.addEventListener('input', function() { ent[key] = this.value; }); fw.appendChild(ta);
            } else {
              var inp = document.createElement('input'); inp.type = type || 'text'; inp.className = 'form-input'; inp.value = ent[key] || '';
              if (opts && opts.placeholder) inp.placeholder = opts.placeholder;
              inp.addEventListener('input', function() { ent[key] = this.value; }); fw.appendChild(inp);
            }
            row.appendChild(fw);
          }
          addField('type', 'Type', 'select', { options: [''].concat(commsTypes) });
          addField('direction', 'Direction', 'select', { options: [''].concat(dirOptions) });
          addField('date', 'Date', 'date');
          addField('time', 'Time', 'time');
          addField('party', 'Person / Party', 'text', { placeholder: 'Who was contacted' });
          addField('partyRole', 'Role', 'select', { options: [''].concat(roleOptions) });
          if (ent.type === 'Telephone Call') addField('duration', 'Duration (mins)', 'number');
          if (ent.type === 'Email') addField('subject', 'Subject', 'text', { full: true });
          addField('summary', 'Summary / Notes', 'textarea', { full: true, placeholder: 'Brief summary of communication' });
          block.appendChild(row);
          block.querySelector('.iv-remove').addEventListener('click', function() { formData.commsLog.splice(idx, 1); renderCommsLog(); });
          container.appendChild(block);
        });
        var addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn-add-disbursement'; addBtn.textContent = '+ Add entry';
        addBtn.addEventListener('click', function() { formData.commsLog.push({ type:'', direction:'', date: new Date().toISOString().slice(0,10), time: pad2(new Date().getHours()) + ':' + pad2(new Date().getMinutes()), party:'', partyRole:'', duration:'', subject:'', summary:'' }); renderCommsLog(); });
        container.appendChild(addBtn);
      }
      renderCommsLog(); wrap.appendChild(container); grid.appendChild(wrap); return;
    }
    /* ── Bail conditions: checkbox rows with inline detail inputs ── */
    if (f.type === 'bailConditions') {
      (function() {
        var BAIL_CONDITIONS = [
          { id: 'residence', label: 'Residence (at specified address)', placeholder: 'Address where client must reside' },
          { id: 'curfew', label: 'Curfew', placeholder: 'Hours, e.g. 8pm - 6am daily' },
          { id: 'reportToStation', label: 'Report to police station', placeholder: 'Station name, days/times' },
          { id: 'surrenderPassport', label: 'Surrender passport / travel documents', placeholder: '' },
          { id: 'noContactVictim', label: 'No contact with victim(s)', placeholder: 'Name(s) of victim(s)' },
          { id: 'noContactWitness', label: 'No contact with witnesses / co-accused', placeholder: 'Name(s)' },
          { id: 'exclusionZone', label: 'Not to enter specified area / address', placeholder: 'Area or address' },
          { id: 'noContactChildren', label: 'No contact with children (specified)', placeholder: 'Name(s) of children' },
          { id: 'electronicTag', label: 'Electronic monitoring (tag)', placeholder: '' },
          { id: 'surety', label: 'Surety / security', placeholder: 'Amount and who provides' },
          { id: 'other', label: 'Other', placeholder: 'Specify condition' }
        ];
        var bwrap = document.createElement('div');
        bwrap.className = 'form-group bail-conditions-wrap';
        bwrap.style.gridColumn = '1 / -1';
        if (f.showIf) { bwrap.dataset.showIfField = f.showIf.field; bwrap.dataset.showIfValue = f.showIf.value || ''; bwrap.dataset.showIfValues = (f.showIf.values || []).join(','); }
        var blbl = document.createElement('label'); blbl.textContent = f.label; bwrap.appendChild(blbl);
        var saved = formData.bailConditionsData || {};
        if (typeof saved === 'string') { try { saved = JSON.parse(saved); } catch (_) { saved = {}; } }
        if (!formData.bailConditionsData && formData.bailConditionsChecklist) {
          var oldChecked = (formData.bailConditionsChecklist || '').split('|').filter(Boolean);
          var oldDetails = formData.bailConditions || '';
          BAIL_CONDITIONS.forEach(function(c) {
            var isChecked = oldChecked.some(function(v) { return c.label === v || (c.id === 'other' && v.indexOf('Other') === 0); });
            if (isChecked) {
              saved[c.id] = { checked: true, detail: c.id === 'other' ? (oldChecked.find(function(v) { return v.indexOf('Other: ') === 0; }) || '').replace('Other: ', '') : '' };
            }
          });
          if (oldDetails && !Object.values(saved).some(function(v) { return v.detail; })) {
            var first = Object.keys(saved).find(function(k) { return saved[k] && saved[k].checked; });
            if (first) saved[first].detail = oldDetails;
          }
          formData.bailConditionsData = saved;
        }
        var bcontainer = document.createElement('div');
        bcontainer.className = 'bail-conditions-list';
        var syncBailData = function() {
          var result = {};
          var checkedLabels = [];
          var detailParts = [];
          BAIL_CONDITIONS.forEach(function(c) {
            var brow = bcontainer.querySelector('[data-bail-id="' + c.id + '"]');
            if (!brow) return;
            var bcb = brow.querySelector('input[type="checkbox"]');
            var binp = brow.querySelector('.bail-detail-input');
            var detail = binp ? binp.value.trim() : '';
            if (bcb && bcb.checked) {
              result[c.id] = { checked: true, detail: detail };
              checkedLabels.push(c.id === 'other' && detail ? 'Other: ' + detail : c.label);
              if (detail) detailParts.push(c.label + ': ' + detail);
            }
          });
          formData.bailConditionsData = result;
          formData.bailConditionsChecklist = checkedLabels.join('|');
          formData.bailConditions = detailParts.join('; ');
        };
        BAIL_CONDITIONS.forEach(function(c) {
          var brow = document.createElement('div');
          brow.className = 'bail-condition-row';
          brow.dataset.bailId = c.id;
          var labelWrap = document.createElement('label');
          labelWrap.className = 'bail-condition-label';
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          var s = saved[c.id];
          if (s && s.checked) cb.checked = true;
          labelWrap.appendChild(cb);
          labelWrap.appendChild(document.createTextNode(' ' + c.label));
          brow.appendChild(labelWrap);
          if (c.placeholder) {
            var detailInput = document.createElement('input');
            detailInput.type = 'text';
            detailInput.className = 'bail-detail-input';
            detailInput.placeholder = c.placeholder;
            detailInput.value = (s && s.detail) || '';
            detailInput.style.display = cb.checked ? '' : 'none';
            detailInput.addEventListener('input', syncBailData);
            brow.appendChild(detailInput);
            cb.addEventListener('change', function() {
              detailInput.style.display = cb.checked ? '' : 'none';
              if (cb.checked) detailInput.focus();
              syncBailData();
            });
          } else {
            cb.addEventListener('change', syncBailData);
          }
          bcontainer.appendChild(brow);
        });
        bwrap.appendChild(bcontainer);
        grid.appendChild(bwrap);
      })();
      return;
    }
    if (f.type === 'checkboxGroup') {
      const wrap = document.createElement('div');
      wrap.className = 'form-group checkbox-group-wrap';
      const isGrounds = (f.key === 'groundsForArrest' || f.key === 'groundsForDetention');
      if (isGrounds) wrap.classList.add('grounds-card');
      else if (f.cols === 2) wrap.style.gridColumn = '1 / -1';
      const lbl = document.createElement('label'); lbl.textContent = f.label;
      if (REQUIRED_FIELD_KEYS.includes(f.key)) { const req = document.createElement('span'); req.className = 'required-asterisk'; req.textContent = ' *'; req.title = 'Required before finalising'; lbl.appendChild(req); }
      wrap.appendChild(lbl);
      const container = document.createElement('div');
      container.className = 'checkbox-group' + (isGrounds ? ' grounds-list' : '');
      const saved = (data[f.key] || '').split('|').filter(Boolean);
      (f.options || []).forEach(opt => {
        const item = document.createElement('label'); item.className = 'checkbox-item' + (isGrounds ? ' grounds-option' : '');
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = opt;
        if (saved.includes(opt)) cb.checked = true;
        cb.addEventListener('change', () => {
          const checked = Array.from(container.querySelectorAll('input:checked')).map(c => c.value);
          formData[f.key] = checked.join('|');
        });
        item.appendChild(cb);
        item.appendChild(document.createTextNode(' ' + opt));
        container.appendChild(item);
      });
      if (f.allowOther) {
        const otherItem = document.createElement('label'); otherItem.className = 'checkbox-item checkbox-other' + (isGrounds ? ' grounds-option' : '');
        const otherCb = document.createElement('input'); otherCb.type = 'checkbox'; otherCb.value = '__other__';
        const otherInput = document.createElement('input'); otherInput.type = 'text'; otherInput.className = 'checkbox-other-input';
        otherInput.placeholder = 'Other (specify)';
        const otherSaved = saved.find(s => s.startsWith('Other: '));
        if (otherSaved) { otherCb.checked = true; otherInput.value = otherSaved.replace('Other: ', ''); }
        const syncOther = () => {
          const checked = Array.from(container.querySelectorAll('input[type=checkbox]:checked')).map(c => c.value).filter(v => v !== '__other__');
          if (otherCb.checked && otherInput.value.trim()) checked.push('Other: ' + otherInput.value.trim());
          formData[f.key] = checked.join('|');
        };
        otherCb.addEventListener('change', syncOther);
        otherInput.addEventListener('input', syncOther);
        otherItem.appendChild(otherCb);
        otherItem.appendChild(document.createTextNode(' '));
        otherItem.appendChild(otherInput);
        container.appendChild(otherItem);
      }
      wrap.appendChild(container);
      grid.appendChild(wrap);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'form-group';
    if (f.className) wrap.classList.add(f.className);
    if (f.firmCompletes) wrap.classList.add('firm-field');
    if (f.cols === 2) wrap.style.gridColumn = '1 / -1';
    if (f.showIf) { wrap.dataset.showIfField = f.showIf.field; wrap.dataset.showIfValue = f.showIf.value || ''; wrap.dataset.showIfValues = (f.showIf.values || []).join(','); }
    if (f.showIfOr) { wrap.dataset.showIfOrField = f.showIfOr.field; wrap.dataset.showIfOrValue = f.showIfOr.value || ''; }
    const label = document.createElement('label');
    label.textContent = f.label;
    if (REQUIRED_FIELD_KEYS.includes(f.key)) {
      const req = document.createElement('span');
      req.className = 'required-asterisk';
      req.textContent = ' *';
      req.title = 'Required before finalising';
      label.appendChild(req);
    }
    if (f.helpTitle) {
      const helpBtn = document.createElement('span');
      helpBtn.className = 'field-help-icon';
      helpBtn.setAttribute('role', 'button');
      helpBtn.setAttribute('tabindex', '0');
      helpBtn.title = f.helpTitle;
      helpBtn.textContent = ' [?]';
      helpBtn.style.cursor = 'help';
      helpBtn.style.marginLeft = '0.25rem';
      label.appendChild(helpBtn);
    }
    if (f.firmCompletes) {
      const badge = document.createElement('span');
      badge.className = 'firm-badge';
      badge.textContent = 'Firm completes';
      label.appendChild(badge);
    }
    wrap.appendChild(label);

    let input;
    if (f.type === 'select') {
      input = document.createElement('select');
      input.innerHTML = '<option value="">-- Select --</option>';
      (f.options || []).forEach(o => { const opt = document.createElement('option'); opt.value = o; opt.textContent = o; input.appendChild(opt); });
    } else if (f.type === 'codedSelect') {
      input = document.createElement('select');
      input.innerHTML = '<option value="">-- Select --</option>';
      codeOptions(f.codeKey).forEach(o => { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; input.appendChild(opt); });
    } else if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 4;
      if (f.placeholder) input.placeholder = f.placeholder;
    } else if (f.type === 'station') {
      renderStationSearch(f, data, wrap, grid);
      return;
    } else if (f.type === 'firm') {
      var firmContainer = document.createElement('div');
      firmContainer.className = 'form-firm-wrap';

      var hiddenFirmInput = document.createElement('input');
      hiddenFirmInput.type = 'hidden';
      hiddenFirmInput.name = f.key;
      hiddenFirmInput.dataset.field = f.key;
      hiddenFirmInput.value = data.firmId || '';
      firmContainer.appendChild(hiddenFirmInput);

      var choiceRow = document.createElement('div');
      choiceRow.className = 'form-firm-choice-row';
      var btnUseExisting = document.createElement('button');
      btnUseExisting.type = 'button';
      btnUseExisting.className = 'btn btn-secondary btn-small form-firm-choice-btn';
      btnUseExisting.textContent = 'Select instructing firm';
      var btnAddNew = document.createElement('button');
      btnAddNew.type = 'button';
      btnAddNew.className = 'btn btn-primary btn-small form-firm-choice-btn';
      btnAddNew.textContent = 'Add new firm';
      choiceRow.appendChild(btnUseExisting);
      choiceRow.appendChild(btnAddNew);
      firmContainer.appendChild(choiceRow);

      var selectedLine = document.createElement('div');
      selectedLine.className = 'form-firm-selected';
      selectedLine.style.display = 'none';
      firmContainer.appendChild(selectedLine);

      var addRow = document.createElement('div');
      addRow.className = 'add-firm-inline-wrap form-firm-add-section';
      addRow.style.display = 'none';
      var firmFields = [
        { id: 'afn', placeholder: 'Firm name *', type: 'text' },
        { id: 'afl', placeholder: 'LAA Account no.', type: 'text' },
        { id: 'afc', placeholder: 'Contact name', type: 'text' },
        { id: 'afp', placeholder: 'Contact phone', type: 'tel' },
        { id: 'afe', placeholder: 'Contact email', type: 'email' },
      ];
      var firmInps = {};
      var addRowInputs = document.createElement('div');
      addRowInputs.className = 'add-firm-inline';
      firmFields.forEach(function(ff) {
        var inp = document.createElement('input');
        inp.type = ff.type;
        inp.className = 'form-input';
        inp.placeholder = ff.placeholder;
        if (ff.type === 'tel') attachPhoneValidation(inp);
        if (ff.type === 'email') attachEmailValidation(inp);
        firmInps[ff.id] = inp;
        addRowInputs.appendChild(inp);
      });
      var addBtnRow = document.createElement('div');
      addBtnRow.className = 'add-firm-inline';
      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn-now';
      addBtn.textContent = 'Add Firm';
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-small';
      cancelBtn.textContent = 'Cancel';
      addBtnRow.appendChild(addBtn);
      addBtnRow.appendChild(cancelBtn);
      addRow.appendChild(addRowInputs);
      addRow.appendChild(addBtnRow);
      firmContainer.appendChild(addRow);

      var useExistingWrap = document.createElement('div');
      useExistingWrap.className = 'form-firm-use-existing-section';
      useExistingWrap.style.display = 'none';
      var searchInp = document.createElement('input');
      searchInp.type = 'text';
      searchInp.className = 'form-input search-input form-firm-search-input';
      searchInp.placeholder = 'Search by firm name or contact…';
      searchInp.autocomplete = 'off';
      useExistingWrap.appendChild(searchInp);
      var resultsDiv = document.createElement('div');
      resultsDiv.className = 'form-firm-search-results';
      resultsDiv.setAttribute('role', 'listbox');
      useExistingWrap.appendChild(resultsDiv);
      firmContainer.appendChild(useExistingWrap);

      function updateSelectedLine() {
        var fid = hiddenFirmInput.value;
        if (!fid) {
          selectedLine.style.display = 'none';
          choiceRow.style.display = 'flex';
          return;
        }
        var fi = firms.find(function(x) { return String(x.id) === fid; });
        if (fi) {
          selectedLine.style.display = 'block';
          selectedLine.innerHTML = '<span class="form-firm-selected-label">Selected: </span><strong>' + esc(fi.name) + '</strong> <button type="button" class="btn-small form-firm-change">Change</button>';
          choiceRow.style.display = 'none';
          selectedLine.querySelector('.form-firm-change').addEventListener('click', function() {
            hiddenFirmInput.value = '';
            formData.firmId = '';
            formData.firmName = '';
            updateSelectedLine();
            choiceRow.style.display = 'flex';
            addRow.style.display = 'none';
            useExistingWrap.style.display = 'none';
          });
        }
      }

      function renderFormFirmResults(filteredList) {
        resultsDiv.innerHTML = '';
        var q = (searchInp.value || '').trim().toLowerCase();
        if (!firms.length) {
          var empty = document.createElement('div');
          empty.className = 'firms-search-result-item firms-search-empty';
          empty.textContent = 'No firms yet. Add a firm first.';
          resultsDiv.appendChild(empty);
        } else if (q && !filteredList.length) {
          var noMatch = document.createElement('div');
          noMatch.className = 'firms-search-result-item firms-search-empty';
          noMatch.textContent = 'No firms match.';
          resultsDiv.appendChild(noMatch);
        } else {
          var list = filteredList.length ? filteredList : firms;
          list.forEach(function(fi) {
            var item = document.createElement('div');
            item.className = 'firms-search-result-item';
            item.setAttribute('role', 'option');
            item.dataset.firmId = String(fi.id);
            item.innerHTML = '<span class="firms-search-result-name">' + esc(fi.name) + '</span>' + (fi.contact_name ? '<span class="firms-search-result-contact">' + esc(fi.contact_name) + '</span>' : '');
            item.addEventListener('click', function() {
              hiddenFirmInput.value = String(fi.id);
              formData.firmId = String(fi.id);
              formData.firmName = fi.name || '';
              setFieldValue('firmLaaAccount', fi.laa_account || '');
              setFieldValue('firmContactName', fi.contact_name || '');
              setFieldValue('firmContactPhone', fi.contact_phone || '');
              setFieldValue('firmContactEmail', fi.contact_email || '');
              useExistingWrap.style.display = 'none';
              searchInp.value = '';
              updateSelectedLine();
            });
            resultsDiv.appendChild(item);
          });
        }
        resultsDiv.classList.add('open');
      }

      btnAddNew.addEventListener('click', function() {
        choiceRow.style.display = 'none';
        addRow.style.display = 'block';
        useExistingWrap.style.display = 'none';
        firmInps.afn.focus();
      });

      btnUseExisting.addEventListener('click', function() {
        choiceRow.style.display = 'none';
        addRow.style.display = 'none';
        useExistingWrap.style.display = 'block';
        searchInp.focus();
        renderFormFirmResults(filterFirmsBySearch(searchInp.value));
      });

      searchInp.addEventListener('input', function() {
        renderFormFirmResults(filterFirmsBySearch(searchInp.value));
      });
      searchInp.addEventListener('focus', function() {
        renderFormFirmResults(filterFirmsBySearch(searchInp.value));
      });

      var hideAddRow = function() {
        addRow.style.display = 'none';
        Object.keys(firmInps).forEach(function(k) { firmInps[k].value = ''; });
        updateSelectedLine();
        choiceRow.style.display = 'flex';
      };
      cancelBtn.addEventListener('click', hideAddRow);
      firmInps.afn.addEventListener('keydown', function(e) { if (e.key === 'Escape') hideAddRow(); });

      addBtn.addEventListener('click', function() {
        var name = firmInps.afn.value.trim();
        if (!name) { firmInps.afn.focus(); firmInps.afn.classList.add('input-error'); return; }
        firmInps.afn.classList.remove('input-error');
        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';
        var newFirm = {
          name: name,
          laa_account: firmInps.afl.value.trim(),
          contact_name: firmInps.afc.value.trim(),
          contact_phone: firmInps.afp.value.trim(),
          contact_email: firmInps.afe.value.trim(),
        };
        window.api.firmSave(newFirm).then(function() {
          return window.api.firmsList();
        }).then(function(f) {
          firms = f;
          var added = firms.find(function(fi) { return fi.name === name; });
          if (added) {
            hiddenFirmInput.value = String(added.id);
            formData.firmId = String(added.id);
            formData.firmName = added.name || '';
            setFieldValue('firmLaaAccount', added.laa_account || '');
            setFieldValue('firmContactName', added.contact_name || '');
            setFieldValue('firmContactPhone', added.contact_phone || '');
            setFieldValue('firmContactEmail', added.contact_email || '');
          }
          addRow.style.display = 'none';
          Object.keys(firmInps).forEach(function(k) { firmInps[k].value = ''; });
          addBtn.disabled = false;
          addBtn.textContent = 'Add Firm';
          updateSelectedLine();
          choiceRow.style.display = 'flex';
        });
      });
      firmInps.afn.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); } });

      hiddenFirmInput.addEventListener('change', updateSelectedLine);
      if (data.firmId != null) hiddenFirmInput.value = data.firmId;
      updateSelectedLine();
      if (data.firmId && !formData.firmName && firms.length) {
        var existing = firms.find(function(x) { return String(x.id) === String(data.firmId); });
        if (existing) formData.firmName = existing.name;
      }

      wrap.appendChild(firmContainer);
      grid.appendChild(wrap);
      return;
    } else if (f.type === 'signature') {
      const sw = document.createElement('div'); sw.className = 'signature-wrap';
      const canvas = document.createElement('canvas'); canvas.className = 'signature-canvas';
      canvas.width = 900; canvas.height = 200; canvas.dataset.sigKey = f.sigKey;
      sw.appendChild(canvas);
      const clr = document.createElement('button'); clr.type = 'button'; clr.className = 'btn-small'; clr.textContent = 'Clear';
      clr.addEventListener('click', () => { clearCanvas(canvas); delete formData[f.sigKey]; if (canvas._strokeHistory) canvas._strokeHistory.length = 0; });
      sw.appendChild(clr);
      const undoBtn = document.createElement('button'); undoBtn.type = 'button'; undoBtn.className = 'btn-small'; undoBtn.textContent = 'Undo';
      undoBtn.style.marginLeft = '4px';
      undoBtn.addEventListener('click', () => {
        const hist = canvas._strokeHistory;
        if (hist && hist.length > 1) {
          hist.pop();
          const prev = hist[hist.length - 1];
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const img = new Image();
          img.onload = () => { ctx.drawImage(img, 0, 0); formData[f.sigKey] = prev; };
          img.src = prev;
        } else if (hist && hist.length <= 1) {
          clearCanvas(canvas); delete formData[f.sigKey]; hist.length = 0;
        }
      });
      sw.appendChild(undoBtn);
      const signBtn = document.createElement('button'); signBtn.type = 'button'; signBtn.className = 'btn-sign-fullscreen'; signBtn.textContent = 'Sign';
      signBtn.addEventListener('click', function() { openFullscreenSignature(canvas, f.sigKey, f.label); });
      sw.appendChild(signBtn);
      wrap.appendChild(sw);
      initSignatureCanvas(canvas, f.sigKey, data);
      grid.appendChild(wrap);
      return;
    } else if (f.type === 'time') {
      const tw = document.createElement('div');
      tw.className = 'time-input-wrap';
      const timeInput = document.createElement('input');
      timeInput.type = 'time'; timeInput.step = '360'; timeInput.name = f.key; timeInput.dataset.field = f.key;
      if (data[f.key]) timeInput.value = data[f.key];
      if (f.readonly) timeInput.readOnly = true;
      if (f.key === 'firstReviewDue' || f.key === 'secondReviewDue' || f.key === 'thirdReviewDue') {
        timeInput.classList.add('review-due-time');
        tw.classList.add('review-due-wrap');
        wrap.classList.add('form-group-review-due');
      }
      tw.appendChild(timeInput);

      if (!f.readonly) {
        const nowBtn = document.createElement('button');
        nowBtn.type = 'button'; nowBtn.className = 'btn-now'; nowBtn.textContent = 'Now';
        nowBtn.title = 'Set to current time';
        nowBtn.addEventListener('click', () => {
          const now = new Date();
          timeInput.value = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
          timeInput.dispatchEvent(new Event('change', { bubbles: true }));
          timeInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
        tw.appendChild(nowBtn);
      }

      wrap.appendChild(tw);
      grid.appendChild(wrap);
      return;
    } else if (f.type === 'datetime-local') {
      const dw = document.createElement('div');
      dw.className = 'time-input-wrap';
      const dtInput = document.createElement('input');
      dtInput.type = 'datetime-local';
      dtInput.name = f.key;
      dtInput.dataset.field = f.key;
      if (data[f.key]) dtInput.value = data[f.key];
      dw.appendChild(dtInput);

      const nowBtn = document.createElement('button');
      nowBtn.type = 'button';
      nowBtn.className = 'btn-now';
      nowBtn.textContent = 'Now';
      nowBtn.addEventListener('click', () => {
        const now = new Date();
        dtInput.value = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + 'T' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
        dtInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      dw.appendChild(nowBtn);
      if (f.setBlank) {
        const setBlankBtn = document.createElement('button');
        setBlankBtn.type = 'button';
        setBlankBtn.className = 'btn-small';
        setBlankBtn.textContent = 'SET BLANK';
        setBlankBtn.addEventListener('click', () => {
          dtInput.value = '';
          formData[f.key] = '';
          dtInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        dw.appendChild(setBlankBtn);
      }
      attachDateValidation(dtInput);

      wrap.appendChild(dw);
      grid.appendChild(wrap);
      return;
    } else if (f.type === 'offenceSummary') {
      input = document.createElement('input');
      input.type = 'text';
      if (f.placeholder) input.placeholder = f.placeholder;
      input.name = f.key; input.dataset.field = f.key;
      const val = data[f.key];
      if (val != null && val !== '') input.value = val;
      const acWrap = document.createElement('div');
      acWrap.className = 'offence-autocomplete-wrap';
      acWrap.style.position = 'relative';
      acWrap.appendChild(input);
      const dd = document.createElement('div');
      dd.className = 'offence-autocomplete-dropdown';
      acWrap.appendChild(dd);
      wrap.appendChild(acWrap);
      initOffenceSummaryAutocomplete(input, dd);
      grid.appendChild(wrap);
      return;
    } else if (f.type === 'offence') {
      input = document.createElement('input');
      input.type = 'text';
      if (f.placeholder) input.placeholder = f.placeholder;
      input.name = f.key; input.dataset.field = f.key;
      const val = data[f.key];
      if (val != null && val !== '') input.value = val;
      const slotMatch = f.key.match(/^offence(\d+)Details$/);
      const slot = slotMatch ? parseInt(slotMatch[1], 10) : 1;
      const acWrap = document.createElement('div');
      acWrap.className = 'offence-autocomplete-wrap';
      acWrap.style.position = 'relative';
      acWrap.appendChild(input);
      const dd = document.createElement('div');
      dd.className = 'offence-autocomplete-dropdown';
      acWrap.appendChild(dd);
      wrap.appendChild(acWrap);
      initOffenceAutocomplete(input, dd, slot);
      if (REQUIRED_FIELD_KEYS.includes(f.key)) {
        input.addEventListener('blur', () => {
          if (!(input.value || '').trim()) input.classList.add('input-error');
          else input.classList.remove('input-error');
        });
        input.addEventListener('input', () => {
          if ((input.value || '').trim()) input.classList.remove('input-error');
        });
      }
      grid.appendChild(wrap);
      return;
    } else {
      input = document.createElement('input');
      input.type = f.type || 'text';
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.readonly) input.readOnly = true;
    }

    input.name = f.key; input.dataset.field = f.key;
    let val = data[f.key];
    if (f.defaultValue != null) { val = f.defaultValue; input.readOnly = true; }
    if (val != null && val !== '') input.value = val;
    if (f.key === 'courtName') {
      const acWrap = document.createElement('div');
      acWrap.className = 'offence-autocomplete-wrap';
      acWrap.style.position = 'relative';
      const dd = document.createElement('div');
      dd.className = 'offence-autocomplete-dropdown';
      acWrap.appendChild(input);
      acWrap.appendChild(dd);
      wrap.appendChild(acWrap);
      initCourtAutocomplete(input, dd);
    } else if (f.type === 'email') {
      const emailWrap = document.createElement('div');
      emailWrap.className = 'email-field-wrap';
      var emailPlaceholderOptions = ['None', 'Not known', 'Not got one', "Don't use"];
      emailWrap.appendChild(input);
      emailPlaceholderOptions.forEach(function (opt) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-small btn-email-option';
        btn.textContent = opt;
        btn.title = 'Copy into field: ' + opt;
        btn.addEventListener('click', function () {
          input.value = opt;
          setFieldValue(f.key, opt);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        emailWrap.appendChild(btn);
      });
      wrap.appendChild(emailWrap);
    } else {
      wrap.appendChild(input);
    }

    if (f.key === 'ourFileNumber' && currentSectionIdx === 0) {
      input.addEventListener('input', function () { triggerClientLookup(this); });
      input.addEventListener('blur', function () { setTimeout(hideClientDropdown, 150); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideClientDropdown(); });
    }

    if (f.key === 'sufficientBenefitTest') {
      const sbtHint = document.createElement('p');
      sbtHint.className = 'field-hint sbt-hint';
      sbtHint.textContent = 'LAA requirement: select the work undertaken that shows sufficient benefit to the client. Add any extra details in the notes field below.';
      wrap.appendChild(sbtHint);
    }

    if (f.key === 'reasonsForAdviceSelect') {
      input.addEventListener('change', () => {
        if (input.value && input.value !== 'Other \u2013 see notes below') {
          const ta = document.querySelector('[data-field="reasonsForAdvice"]');
          if (ta) {
            ta.value = (ta.value ? ta.value + '\n' : '') + input.value;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            formData.reasonsForAdvice = ta.value;
          }
        }
      });
    }

    if (f.key === 'dsccRef') {
      const dsccErr = document.createElement('span');
      dsccErr.className = 'field-error';
      dsccErr.style.display = 'none';
      wrap.appendChild(dsccErr);
      input.addEventListener('focus', () => {
        dsccErr.style.display = 'none';
        input.classList.remove('input-error');
      });
      input.addEventListener('blur', () => {
        const v = (input.value || '').trim().toUpperCase();
        if (!v) { dsccErr.style.display = 'none'; input.classList.remove('input-error'); return; }
        if (v.length !== 10 || v.charAt(9) !== 'A') {
          dsccErr.textContent = 'DSCC must be exactly 10 characters ending in A (e.g. 110154321A)';
          dsccErr.style.display = 'block';
          input.classList.add('input-error');
        } else {
          dsccErr.style.display = 'none';
          input.classList.remove('input-error');
          input.value = v; /* auto-uppercase on valid entry */
        }
      });
    }

    /* ─── Type-specific validation ─── */
    if (f.type === 'tel') {
      attachPhoneValidation(input);
    }
    if (f.type === 'email') {
      attachEmailValidation(input);
    }
    if (f.key === 'niNumber') {
      attachNiNumberValidation(input);
    }
    if (f.type === 'date') {
      attachDateValidation(input);
    }

    if (f.key === 'dob' || f.key === 'retainerDob') {
      input.type = 'text';
      input.placeholder = 'DD/MM/YYYY e.g. 15/03/1987';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      if (data[f.key]) input.value = isoToDobDisplay(data[f.key]);
      input.addEventListener('blur', function () {
        var raw = (input.value || '').trim();
        var errEl = _getOrCreateFieldError(input);
        if (!raw) { errEl.style.display = 'none'; input.classList.remove('input-error'); formData[f.key] = ''; return; }
        var parsed = parseDobInput(raw);
        if (parsed) {
          input.value = parsed.display;
          formData[f.key] = parsed.iso;
          errEl.style.display = 'none';
          input.classList.remove('input-error');
        } else {
          errEl.textContent = 'Enter date as DD/MM/YYYY, DD-MM-YY, DD Mon YYYY, or DDMMYYYY';
          errEl.style.display = 'block';
          input.classList.add('input-error');
        }
        if (f.key === 'dob') updateDobAgeDisplay(input, wrap);
      });
      input.addEventListener('input', function () {
        var errEl = _getOrCreateFieldError(input);
        errEl.style.display = 'none';
        input.classList.remove('input-error');
      });
    }

    if (f.key === 'dob') {
      const ageWrap = document.createElement('div');
      ageWrap.className = 'dob-age-display';
      ageWrap.setAttribute('aria-live', 'polite');
      wrap.appendChild(ageWrap);
      updateDobAgeDisplay(input, wrap);
    }

    if (f.type === 'textarea') {
      const wc = document.createElement('div');
      wc.className = 'word-counter';
      wc.textContent = countWords(input.value);
      input.addEventListener('input', () => { wc.textContent = countWords(input.value); });
      wrap.appendChild(wc);
    }


    if (f.type === 'textarea' && TEMPLATE_PHRASES[f.key]) {
      renderTemplateButton(wrap, input, TEMPLATE_PHRASES[f.key]);
    }

    if (f.type === 'textarea' && ['disclosureNarrative','clientInstructions','reasonsForAdvice','firstContactOver45MinsReason'].includes(f.key)) {
      const tsBtn = document.createElement('button');
      tsBtn.type = 'button';
      tsBtn.className = 'btn-small btn-timestamp';
      tsBtn.textContent = 'Timestamp';
      tsBtn.title = 'Insert [HH:MM] at cursor';
      tsBtn.addEventListener('click', () => {
        const now = new Date();
        const stamp = '[' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + '] ';
        const pos = input.selectionStart != null ? input.selectionStart : input.value.length;
        input.value = input.value.slice(0, pos) + stamp + input.value.slice(pos);
        input.selectionStart = input.selectionEnd = pos + stamp.length;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      wrap.appendChild(tsBtn);
    }

    if (REQUIRED_FIELD_KEYS.includes(f.key) && input) {
      input.addEventListener('blur', () => {
        if (!(input.value || '').trim()) input.classList.add('input-error');
        else input.classList.remove('input-error');
      });
      const clearEvent = input.tagName === 'SELECT' ? 'change' : 'input';
      input.addEventListener(clearEvent, () => {
        if ((input.value || '').trim()) input.classList.remove('input-error');
      });
    }

    grid.appendChild(wrap);
  }

  /* ─── WORD COUNTER ─── */
  function countWords(text) {
    if (!text || !text.trim()) return '0 words';
    const w = text.trim().split(/\s+/).length;
    return w + ' word' + (w !== 1 ? 's' : '');
  }

  /* ─── TEMPLATE PHRASE BUTTON ─── */
  function renderTemplateButton(wrap, textarea, phrases) {
    const tw = document.createElement('div');
    tw.className = 'template-btn-wrap';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn-template'; btn.textContent = 'Templates';
    const dd = document.createElement('div');
    dd.className = 'template-dropdown';
    phrases.forEach(phrase => {
      const opt = document.createElement('div');
      opt.className = 'template-option';
      opt.textContent = phrase.length > 70 ? phrase.slice(0, 70) + '...' : phrase;
      opt.title = phrase;
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const cur = textarea.value;
        textarea.value = cur ? cur + '\n' + phrase : phrase;
        textarea.dispatchEvent(new Event('input'));
        dd.classList.remove('open');
      });
      dd.appendChild(opt);
    });
    btn.addEventListener('click', () => dd.classList.toggle('open'));
    btn.addEventListener('blur', () => setTimeout(() => dd.classList.remove('open'), 150));
    tw.appendChild(dd);
    tw.appendChild(btn);
    wrap.appendChild(tw);
  }

  /* ─── SEARCHABLE STATION PICKER (#3 + #12 recent) ─── */
  function renderStationSearch(f, data, wrap, grid) {
    const sw = document.createElement('div');
    sw.className = 'station-search-wrap';
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden'; hiddenInput.name = f.key; hiddenInput.dataset.field = f.key;
    if (data.policeStationId) hiddenInput.value = data.policeStationId;

    const textInput = document.createElement('input');
    textInput.type = 'text'; textInput.placeholder = 'Type to search stations...';
    textInput.autocomplete = 'off';
    if (data.policeStationId) {
      const match = stations.find(s => String(s.id) === String(data.policeStationId));
      if (match) textInput.value = match.name + '  [' + match.code + ']  —  ' + match.scheme;
    }

    const sugList = document.createElement('div');
    sugList.className = 'station-suggestions';

    function buildSuggestions(query) {
      sugList.innerHTML = '';
      const q = (query || '').toLowerCase().trim();
      let results = [];
      if (!q) {
        const recentItems = recentStationIds.map(rid => stations.find(s => s.id === rid)).filter(Boolean);
        if (recentItems.length) {
          recentItems.forEach(s => {
            results.push({ station: s, isRecent: true });
          });
        }
        stations.slice(0, 15).forEach(s => {
          if (!results.find(r => r.station.id === s.id)) results.push({ station: s, isRecent: false });
        });
      } else {
        const recentItems = recentStationIds.map(rid => stations.find(s => s.id === rid)).filter(Boolean);
        recentItems.forEach(s => {
          if ((s.name + ' ' + s.code + ' ' + s.scheme + ' ' + s.region).toLowerCase().includes(q)) {
            results.push({ station: s, isRecent: true });
          }
        });
        stations.forEach(s => {
          if (results.find(r => r.station.id === s.id)) return;
          if ((s.name + ' ' + s.code + ' ' + s.scheme + ' ' + s.region).toLowerCase().includes(q)) {
            results.push({ station: s, isRecent: false });
          }
        });
        results = results.slice(0, 20);
      }
      if (!results.length) {
        sugList.innerHTML = '<div class="station-suggestion" style="color:var(--text-muted);">No stations found</div>';
        return;
      }
      results.forEach(r => {
        const div = document.createElement('div');
        div.className = 'station-suggestion';
        div.innerHTML = '<strong>' + esc(r.station.name) + '</strong>' +
          '<span class="station-code">[' + esc(r.station.code) + ']</span> ' +
          '<span style="color:var(--text-muted);">' + esc(r.station.scheme) + '</span>' +
          '<span class="station-region">' + esc(r.station.region) + '</span>' +
          (r.isRecent ? '<span class="station-recent-tag">Recent</span>' : '');
        div.addEventListener('mousedown', (e) => {
          e.preventDefault();
          hiddenInput.value = r.station.id;
          textInput.value = r.station.name + '  [' + r.station.code + ']  —  ' + r.station.scheme;
          formData.policeStationId = String(r.station.id);
          formData.policeStationName = r.station.name + ' (' + r.station.scheme + ')';
          formData.policeStationCode = r.station.code;
          formData.schemeId = r.station.code;
          setFieldValue('schemeId', r.station.code);
          sugList.classList.remove('open');
          saveRecentStation(r.station.id);
        });
        sugList.appendChild(div);
      });
    }

    textInput.addEventListener('focus', () => { buildSuggestions(textInput.value); sugList.classList.add('open'); });
    textInput.addEventListener('input', () => { buildSuggestions(textInput.value); sugList.classList.add('open'); });
    textInput.addEventListener('blur', () => {
      setTimeout(() => sugList.classList.remove('open'), 150);
      if (!hiddenInput.value) textInput.classList.add('input-error');
      else textInput.classList.remove('input-error');
    });
    textInput.addEventListener('input', () => { textInput.classList.remove('input-error'); });

    sw.appendChild(textInput);
    sw.appendChild(hiddenInput);
    sw.appendChild(sugList);
    wrap.appendChild(sw);
    grid.appendChild(wrap);
  }

  function initCourtAutocomplete(input, dropdown) {
    function setSuggestions(query) {
      const q = String(query || '').toLowerCase().trim();
      dropdown.innerHTML = '';
      let items = [];
      if (!q) {
        items = magistratesCourts.slice(0, 12);
      } else {
        items = magistratesCourts.filter(function(name) {
          return name.toLowerCase().includes(q);
        }).slice(0, 20);
      }
      if (!items.length) {
        dropdown.classList.remove('open');
        return;
      }
      items.forEach(function(name) {
        const opt = document.createElement('div');
        opt.className = 'offence-autocomplete-option';
        opt.textContent = name;
        opt.addEventListener('mousedown', function(e) {
          e.preventDefault();
          input.value = name;
          formData.courtName = name;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          dropdown.classList.remove('open');
        });
        dropdown.appendChild(opt);
      });
      dropdown.classList.add('open');
    }

    input.addEventListener('focus', function() { setSuggestions(input.value); });
    input.addEventListener('input', function() { setSuggestions(input.value); });
    input.addEventListener('blur', function() {
      setTimeout(function() { dropdown.classList.remove('open'); }, 150);
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') dropdown.classList.remove('open');
    });
  }

  /* ─── OFFENCE AUTOCOMPLETE (inline on offence Details fields) ─── */
  function initOffenceAutocomplete(input, dropdown, slot) {
    const flatOffences = [];
    OFFENCES_BY_GROUP.forEach(grp => {
      (grp.offences || []).forEach(off => {
        flatOffences.push({ ...off, defaultMatterType: off.matterType || grp.defaultMatterType || '11' });
      });
    });

    function showSuggestions(q) {
      const query = (q || '').toLowerCase().trim();
      const matches = query.length >= 2
        ? flatOffences.filter(o => o.name.toLowerCase().includes(query))
        : [];
      const limit = 10;
      dropdown.innerHTML = '';
      if (matches.length === 0) { dropdown.classList.remove('open'); return; }
      matches.slice(0, limit).forEach(off => {
        const opt = document.createElement('div');
        opt.className = 'offence-autocomplete-option';
        opt.innerHTML = esc(off.name) + '<span class="offence-statute">' + esc(off.statute || '') + '</span>';
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const mode = (off.mode === 'SO' || off.mode === 'EW' || off.mode === 'IO') ? off.mode : 'EW';
          const statute = off.statute ? String(off.statute) : '';
          setFieldValue('offence' + slot + 'Details', off.name);
          setFieldValue('offence' + slot + 'Statute', statute);
          setFieldValue('offence' + slot + 'ModeOfTrial', mode);
          setFieldValue('matterTypeCode', off.defaultMatterType);
          input.value = off.name;
          dropdown.classList.remove('open');
          applyConditionalVisibility();
        });
        dropdown.appendChild(opt);
      });
      dropdown.classList.add('open');
    }

    input.addEventListener('input', () => { showSuggestions(input.value); });
    input.addEventListener('focus', () => { showSuggestions(input.value); });
    input.addEventListener('blur', () => { setTimeout(() => dropdown.classList.remove('open'), 150); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') dropdown.classList.remove('open');
    });
  }

  /* ─── OFFENCE SUMMARY AUTOCOMPLETE (first page – sets offenceSummary only) ─── */
  function initOffenceSummaryAutocomplete(input, dropdown) {
    const flatOffences = [];
    OFFENCES_BY_GROUP.forEach(grp => {
      (grp.offences || []).forEach(off => {
        flatOffences.push({ ...off });
      });
    });

    function showSuggestions(q) {
      const query = (q || '').toLowerCase().trim();
      const matches = query.length >= 2
        ? flatOffences.filter(o => o.name.toLowerCase().includes(query))
        : [];
      const limit = 10;
      dropdown.innerHTML = '';
      if (matches.length === 0) { dropdown.classList.remove('open'); return; }
      matches.slice(0, limit).forEach(off => {
        const opt = document.createElement('div');
        opt.className = 'offence-autocomplete-option';
        opt.innerHTML = esc(off.name) + '<span class="offence-statute">' + esc(off.statute || '') + '</span>';
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = off.name;
          setFieldValue('offenceSummary', off.name);
          dropdown.classList.remove('open');
        });
        dropdown.appendChild(opt);
      });
      dropdown.classList.add('open');
    }

    input.addEventListener('input', () => { showSuggestions(input.value); });
    input.addEventListener('focus', () => { showSuggestions(input.value); });
    input.addEventListener('blur', () => { setTimeout(() => dropdown.classList.remove('open'), 150); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') dropdown.classList.remove('open');
    });
  }

  /* ─── OFFENCES PICKER (grouped UK criminal offences with type-ahead search) ─── */
  function renderOffencePicker(section) {
    const wrap = document.createElement('div');
    wrap.className = 'offence-picker-wrap';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn-offence-pick'; btn.textContent = 'Offences';
    const dd = document.createElement('div');
    dd.className = 'offence-dropdown offence-dropdown-grouped';

    /* Search input at top */
    const searchInput = document.createElement('input');
    searchInput.type = 'text'; searchInput.className = 'offence-search-input';
    searchInput.placeholder = 'Type to search offences\u2026';
    dd.appendChild(searchInput);

    const itemsContainer = document.createElement('div');
    OFFENCES_BY_GROUP.forEach(grp => {
      const groupHeader = document.createElement('div');
      groupHeader.className = 'offence-group-header';
      groupHeader.textContent = grp.group;
      groupHeader.dataset.group = 'header';
      itemsContainer.appendChild(groupHeader);
      (grp.offences || []).forEach(off => {
        const opt = document.createElement('div');
        opt.className = 'offence-option';
        opt.dataset.searchText = (off.name + ' ' + off.statute).toLowerCase();
        opt.dataset.group = grp.group;
        opt.innerHTML = esc(off.name) + '<span class="offence-statute">' + esc(off.statute) + '</span>';
        opt.addEventListener('click', () => {
          collectCurrentData();
          const d1 = (getFieldValue('offence1Details') || '').trim();
          const d2 = (getFieldValue('offence2Details') || '').trim();
          const d3 = (getFieldValue('offence3Details') || '').trim();
          const slot = !d1 ? 1 : (!d2 ? 2 : (!d3 ? 3 : 4));
          const mode = (off.mode === 'SO' || off.mode === 'EW' || off.mode === 'IO') ? off.mode : 'EW';
          const statute = off.statute ? String(off.statute) : '';
          const matterType = off.matterType || grp.defaultMatterType || '11';
          setFieldValue('matterTypeCode', matterType);
          setFieldValue('offence' + slot + 'Details', off.name);
          setFieldValue('offence' + slot + 'Statute', statute);
          setFieldValue('offence' + slot + 'ModeOfTrial', mode);
          dd.classList.remove('open');
          searchInput.value = '';
        });
        itemsContainer.appendChild(opt);
      });
    });
    dd.appendChild(itemsContainer);

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      const visibleGroups = new Set();
      itemsContainer.querySelectorAll('.offence-option').forEach(opt => {
        const match = !q || opt.dataset.searchText.indexOf(q) !== -1;
        opt.style.display = match ? '' : 'none';
        if (match) visibleGroups.add(opt.dataset.group);
      });
      itemsContainer.querySelectorAll('.offence-group-header').forEach(hdr => {
        hdr.style.display = visibleGroups.has(hdr.textContent) ? '' : 'none';
      });
    });

    btn.addEventListener('click', () => {
      dd.classList.toggle('open');
      if (dd.classList.contains('open')) { searchInput.value = ''; searchInput.focus(); searchInput.dispatchEvent(new Event('input')); }
    });
    wrap.appendChild(btn);
    wrap.appendChild(dd);
    section.insertBefore(wrap, section.firstChild);
  }

  /* ─── NO COMMENT INTERVIEW TEMPLATE ─── */
  function renderNoCommentButton(section) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn-no-comment';
    btn.textContent = 'Quick: No Comment Interview';
    btn.addEventListener('click', () => {
      if (!formData.interviews) formData.interviews = [{}];
      const iv = formData.interviews[0];
      const now = new Date();
      if (!iv.startTime) iv.startTime = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      iv.cautioned = 'Yes';
      iv.notes = 'No comment to all questions put. Client remained silent throughout as advised.';
      const container = document.getElementById('multi-interview-container');
      if (container) {
        const sec = activeFormSections.find(s => s.multiInterview);
        if (sec) {
          container.remove();
          renderMultiInterview(section, formData, sec);
        }
      }
    });
    section.insertBefore(btn, section.firstChild);
  }

  /* ─── CONDITIONAL VISIBILITY ─── */
  function applyConditionalVisibility() {
    document.querySelectorAll('[data-show-if-field]').forEach(wrap => {
      const field = wrap.dataset.showIfField;
      const val = formData[field] || getFieldValue(field);
      const matchVal = wrap.dataset.showIfValue;
      const matchVals = (wrap.dataset.showIfValues || '').split(',').filter(Boolean);
      let visible = false;
      if (matchVal) visible = val === matchVal;
      if (matchVals.length) visible = matchVals.includes(val);
      const orField = wrap.dataset.showIfOrField;
      if (orField) {
        const orVal = formData[orField] || getFieldValue(orField);
        const orMatchVal = wrap.dataset.showIfOrValue;
        if (orMatchVal && (orVal === orMatchVal || (orVal && orVal.split('|').indexOf(orMatchVal) >= 0))) visible = true;
      }
      wrap.style.display = visible ? '' : 'none';
    });
    const faWrap = document.getElementById('further-attendance-wrap');
    if (faWrap) faWrap.style.display = formData.furtherAttendance === 'Yes' ? '' : 'none';

    /* Auto-set passported benefit from benefit type */
    var PASSPORTING = ['Universal Credit','Universal Credit (with housing element)','Income Support','Income-based JSA (Jobseeker\'s Allowance)','Income-related ESA (Employment & Support Allowance)','Pension Credit (Guarantee Credit)'];
    var bt = formData.benefitType;
    if (bt && bt !== 'Other') {
      var pp = PASSPORTING.indexOf(bt) >= 0 ? 'Yes' : 'No';
      if (formData.passportedBenefit !== pp) { formData.passportedBenefit = pp; setFieldValue('passportedBenefit', pp); }
    } else if (!bt) {
      if (formData.passportedBenefit !== 'Unknown') { formData.passportedBenefit = 'Unknown'; setFieldValue('passportedBenefit', 'Unknown'); }
    }

    /* Auto-stamp invoice sent date/time */
    if (formData.invoiceSent === 'Yes' && !formData.invoiceSentDate) {
      var now = new Date(); formData.invoiceSentDate = now.toISOString().slice(0, 10);
      formData.invoiceSentTime = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      setFieldValueSilent('invoiceSentDate', formData.invoiceSentDate);
      setFieldValueSilent('invoiceSentTime', formData.invoiceSentTime);
    }

    updateProgressBar();
  }

  /* ─── MULTI-INTERVIEW ─── */
  function renderMultiInterview(section, data, sec) {
    const interviews = data.interviews || [{}];
    const warningEl = document.createElement('p');
    warningEl.className = 'interview-notes-warning';
    warningEl.setAttribute('role', 'alert');
    warningEl.textContent = 'These notes are not verbatim and should not be relied upon as if a transcript.';
    section.appendChild(warningEl);
    const container = document.createElement('div');
    container.id = 'multi-interview-container';

    function renderInterviews() {
      container.innerHTML = '';
      const arr = formData.interviews || [{}];
      arr.forEach((iv, idx) => {
        const block = document.createElement('div');
        block.className = 'interview-block';
        block.innerHTML = '<h3 class="interview-heading">Interview ' + (idx + 1) + (idx > 0 ? ' <button type="button" class="btn-small iv-remove" data-idx="' + idx + '">Remove</button>' : '') + '</h3>';
        const grid = document.createElement('div');
        grid.className = 'form-row-2col';
        sec.interviewFields.forEach(f => {
          const fieldKey = 'iv' + idx + '_' + f.key;
          const fieldDef = Object.assign({}, f, { key: fieldKey });
          if (f.key === 'notes') TEMPLATE_PHRASES[fieldKey] = IV_TEMPLATES.notes;
          const vals = Object.assign({}, formData);
          vals[fieldKey] = iv[f.key] || '';
          renderField(fieldDef, vals, grid);
          if (f.key === 'notes') {
            const ta = grid.querySelector('[data-field="' + fieldKey + '"]');
            if (ta) {
              const tsBtn = document.createElement('button');
              tsBtn.type = 'button';
              tsBtn.className = 'btn-small btn-timestamp';
              tsBtn.textContent = 'Timestamp';
              tsBtn.addEventListener('click', () => {
                const now = new Date();
                const stamp = '[' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + '] ';
                const pos = ta.selectionStart || ta.value.length;
                ta.value = ta.value.slice(0, pos) + stamp + ta.value.slice(pos);
                ta.focus();
                ta.selectionStart = ta.selectionEnd = pos + stamp.length;
              });
              ta.parentElement.appendChild(tsBtn);
            }
          }
        });
        block.appendChild(grid);
        container.appendChild(block);
        block.querySelector('.iv-remove')?.addEventListener('click', () => {
          formData.interviews.splice(idx, 1);
          renderInterviews();
        });
      });
      const addBtn = document.createElement('button');
      addBtn.type = 'button'; addBtn.className = 'btn btn-secondary';
      addBtn.textContent = '+ Add another interview';
      addBtn.addEventListener('click', () => {
        if (!formData.interviews) formData.interviews = [{}];
        formData.interviews.push({});
        renderInterviews();
      });
      container.appendChild(addBtn);
    }

    if (!formData.interviews) formData.interviews = interviews;
    renderInterviews();
    section.appendChild(container);
  }

  /* ─── SIGNATURE ─── */
  function getCanvasCoords(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    if (e.touches && e.touches.length > 0) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function initSignatureCanvas(canvas, sigKey, data) {
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    let drawing = false;
    let lastTouchEnd = 0;
    const strokeHistory = [];
    const saveSnapshot = () => { strokeHistory.push(canvas.toDataURL()); };
    const stampSignature = () => {
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const time = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      if (sigKey === 'repInstructionsSig' || sigKey === 'clientInstructionsSig') {
        setFieldValueSilent('instructionsSignatureDate', date);
        setFieldValueSilent('instructionsSignatureTime', time);
      } else if (sigKey === 'clientSig' || sigKey === 'feeEarnerSig') {
        setFieldValueSilent('laaSignatureDate', date);
        setFieldValueSilent('laaSignatureTime', time);
      } else if (sigKey === 'supervisorSig') {
        setFieldValueSilent('supervisorDate', date);
        setFieldValueSilent('supervisorTime', time);
      } else if (sigKey === 'repConfirmationSig') {
        setFieldValueSilent('policeStationFinalisedDate', date);
        setFieldValueSilent('policeStationFinalisedTime', time);
      }
    };
    const saveSig = () => {
      drawing = false;
      saveSnapshot();
      formData[sigKey] = canvas.toDataURL();
      stampSignature();
      quietSave();
    };
    const ignoreMouse = () => Date.now() - lastTouchEnd < 500;
    if (data[sigKey]) { const img = new Image(); img.onload = () => { ctx.drawImage(img, 0, 0); saveSnapshot(); }; img.src = data[sigKey]; }
    canvas._strokeHistory = strokeHistory;
    canvas.addEventListener('mousedown', e => { if (ignoreMouse()) return; drawing = true; const p = getCanvasCoords(canvas, e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    canvas.addEventListener('mousemove', e => { if (ignoreMouse() || !drawing) return; const p = getCanvasCoords(canvas, e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    canvas.addEventListener('mouseup', () => { if (ignoreMouse()) return; saveSig(); });
    canvas.addEventListener('mouseleave', () => { if (drawing && !ignoreMouse()) saveSig(); });
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 0) return;
      drawing = true;
      const p = getCanvasCoords(canvas, e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      if (!drawing || e.touches.length === 0) return;
      e.preventDefault();
      const p = getCanvasCoords(canvas, e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }, { passive: false });
    canvas.addEventListener('touchend', () => { if (drawing) saveSig(); lastTouchEnd = Date.now(); }, { passive: true });
    canvas.addEventListener('touchcancel', () => { if (drawing) saveSig(); lastTouchEnd = Date.now(); }, { passive: true });
  }

  function clearCanvas(c) { c.getContext('2d').clearRect(0, 0, c.width, c.height); }

  function openFullscreenSignature(inlineCanvas, sigKey, label) {
    var overlay = document.createElement('div');
    overlay.className = 'sig-fullscreen-overlay';
    var titleEl = document.createElement('div'); titleEl.className = 'sig-fs-label'; titleEl.textContent = label || 'Signature';
    overlay.appendChild(titleEl);
    var fsCanvas = document.createElement('canvas');
    fsCanvas.width = 1200; fsCanvas.height = 500;
    overlay.appendChild(fsCanvas);
    var btnRow = document.createElement('div'); btnRow.className = 'sig-fs-buttons';
    var clearBtn = document.createElement('button'); clearBtn.textContent = 'Clear'; clearBtn.className = 'sig-fs-btn-clear';
    var doneBtn = document.createElement('button'); doneBtn.textContent = 'Done'; doneBtn.className = 'sig-fs-btn-done';
    var cancelBtn = document.createElement('button'); cancelBtn.textContent = 'Cancel'; cancelBtn.className = 'sig-fs-btn-cancel';
    btnRow.appendChild(clearBtn); btnRow.appendChild(doneBtn); btnRow.appendChild(cancelBtn);
    overlay.appendChild(btnRow);
    document.body.appendChild(overlay);
    var ctx = fsCanvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, fsCanvas.width, fsCanvas.height);
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    if (formData[sigKey]) {
      var existing = new Image();
      existing.onload = function() { ctx.drawImage(existing, 0, 0, fsCanvas.width, fsCanvas.height); };
      existing.src = formData[sigKey];
    }
    var drawing = false; var lastTouchEnd = 0;
    var ignoreMouse = function() { return Date.now() - lastTouchEnd < 500; };
    fsCanvas.addEventListener('mousedown', function(e) { if (ignoreMouse()) return; drawing = true; var p = getCanvasCoords(fsCanvas, e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    fsCanvas.addEventListener('mousemove', function(e) { if (ignoreMouse() || !drawing) return; var p = getCanvasCoords(fsCanvas, e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    fsCanvas.addEventListener('mouseup', function() { if (ignoreMouse()) return; drawing = false; });
    fsCanvas.addEventListener('mouseleave', function() { drawing = false; });
    fsCanvas.addEventListener('touchstart', function(e) { if (!e.touches.length) return; drawing = true; var p = getCanvasCoords(fsCanvas, e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: true });
    fsCanvas.addEventListener('touchmove', function(e) { if (!drawing || !e.touches.length) return; e.preventDefault(); var p = getCanvasCoords(fsCanvas, e); ctx.lineTo(p.x, p.y); ctx.stroke(); }, { passive: false });
    fsCanvas.addEventListener('touchend', function() { drawing = false; lastTouchEnd = Date.now(); }, { passive: true });
    fsCanvas.addEventListener('touchcancel', function() { drawing = false; lastTouchEnd = Date.now(); }, { passive: true });
    clearBtn.addEventListener('click', function() { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, fsCanvas.width, fsCanvas.height); ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 3; ctx.lineCap = 'round'; });
    doneBtn.addEventListener('click', function() {
      var iCtx = inlineCanvas.getContext('2d');
      iCtx.clearRect(0, 0, inlineCanvas.width, inlineCanvas.height);
      iCtx.drawImage(fsCanvas, 0, 0, inlineCanvas.width, inlineCanvas.height);
      formData[sigKey] = inlineCanvas.toDataURL();
      if (inlineCanvas._strokeHistory) { inlineCanvas._strokeHistory.length = 0; inlineCanvas._strokeHistory.push(formData[sigKey]); }
      var now = new Date(); var date = now.toISOString().slice(0, 10); var time = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      if (sigKey === 'repInstructionsSig' || sigKey === 'clientInstructionsSig') { setFieldValueSilent('instructionsSignatureDate', date); setFieldValueSilent('instructionsSignatureTime', time); }
      else if (sigKey === 'clientSig' || sigKey === 'feeEarnerSig') { setFieldValueSilent('laaSignatureDate', date); setFieldValueSilent('laaSignatureTime', time); }
      else if (sigKey === 'supervisorSig') { setFieldValueSilent('supervisorDate', date); setFieldValueSilent('supervisorTime', time); }
      else if (sigKey === 'repConfirmationSig') { setFieldValueSilent('policeStationFinalisedDate', date); setFieldValueSilent('policeStationFinalisedTime', time); }
      quietSave();
      document.body.removeChild(overlay);
    });
    cancelBtn.addEventListener('click', function() { document.body.removeChild(overlay); });
  }



  /* ─── DATA COLLECTION ─── */
  function collectCurrentData() {
    const form = document.getElementById('attendance-form');
    if (!form) return;
    const ss = form.querySelector('input[data-field="policeStationId"]');
    if (ss) { formData.policeStationId = ss.value || null; }
    const fs = form.querySelector('[data-field="firmId"]');
    if (fs) {
      formData.firmId = (fs.value || '').trim() || null;
      if (formData.firmId && firms.length) {
        const fi = firms.find(function(x) { return String(x.id) === String(formData.firmId); });
        formData.firmName = fi ? fi.name : (formData.firmName || '');
      } else if (!formData.firmId) formData.firmName = '';
    }
    form.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
      if (el.type === 'checkbox') formData[el.name] = el.checked;
      else if (el.name && !['policeStationId', 'firmId'].includes(el.dataset.field)) formData[el.name] = el.value;
    });
    form.querySelectorAll('.checkbox-group-wrap').forEach(wrap => {
      const firstCb = wrap.querySelector('input[type="checkbox"]');
      if (!firstCb) return;
      const key = wrap.closest('[data-show-if-field]')?.dataset?.showIfField
        ? null
        : null;
      const container = wrap.querySelector('.checkbox-group');
      if (!container) return;
      const checked = Array.from(container.querySelectorAll('input[type=checkbox]:checked'))
        .map(c => c.value)
        .filter(v => v !== '__other__');
      const otherCb = container.querySelector('.checkbox-other input[type=checkbox]');
      const otherInput = container.querySelector('.checkbox-other-input');
      if (otherCb && otherCb.checked && otherInput && otherInput.value.trim()) {
        checked.push('Other: ' + otherInput.value.trim());
      }
      const lbl = wrap.querySelector('label');
      if (lbl) {
        const matchingField = activeFormSections.flatMap(s => s.fields || []).find(f => f.type === 'checkboxGroup' && f.label === lbl.textContent);
        if (matchingField) formData[matchingField.key] = checked.join('|');
      }
    });
    // Signatures are captured/stamped directly by initSignatureCanvas().
    collectInterviewData();
    collectDisbursementData(form);
    collectPaceSearchData(form);
    collectForensicSampleData(form);
    collectAttendingContactData(form);
  }

  function collectPaceSearchData(form) {
    const container = form.querySelector('#multi-pace-search-container');
    if (!container) return;
    const blocks = Array.from(container.children).filter(el => el.classList.contains('pace-search-block'));
    if (!blocks.length) return;
    formData.paceSearches = blocks.map(block => {
      const typeSel = block.querySelector('select.pace-search-type');
      const foundInp = block.querySelector('input[type="text"]');
      return {
        searchType: typeSel ? typeSel.value : '',
        whatFound: foundInp ? foundInp.value : '',
      };
    });
  }

  function collectForensicSampleData(form) {
    const container = form.querySelector('#multi-forensic-sample-container');
    if (!container) return;
    const blocks = container.querySelectorAll('.forensic-sample-block');
    if (!blocks.length) return;
    formData.forensicSamples = Array.from(blocks).map(block => {
      const typeSel = block.querySelector('.forensic-sample-type');
      const doneSel = block.querySelector('.forensic-sample-done');
      const notesInp = block.querySelector('input[type="text"]');
      return {
        sampleType: typeSel ? typeSel.value : '',
        whatDone: doneSel ? doneSel.value : '',
        notes: notesInp ? notesInp.value : '',
      };
    });
  }

  function collectAttendingContactData(form) {
    const container = form.querySelector('.multi-attending-contact-container');
    if (!container) return;
    const blocks = container.querySelectorAll('.attending-contact-block');
    if (!blocks.length) return;
    formData.attendingContacts = Array.from(blocks).map(block => {
      const typeSel = block.querySelector('select');
      const timeInp = block.querySelector('input[type="time"]');
      const outcomeInp = block.querySelector('input[type="text"]');
      const notesInp = block.querySelector('textarea');
      return {
        contactType: typeSel ? typeSel.value : '',
        time: timeInp ? timeInp.value : '',
        outcome: outcomeInp ? outcomeInp.value : '',
        notes: notesInp ? notesInp.value : '',
      };
    });
  }

  function collectDisbursementData(form) {
    const container = form.querySelector('#multi-disbursement-container');
    if (!container) return;
    const blocks = container.querySelectorAll('.disbursement-block');
    if (!blocks.length) return;
    formData.disbursements = Array.from(blocks).map(block => {
      const desc = block.querySelector('input[type="text"]');
      const amt = block.querySelector('input[type="number"]');
      const vat = block.querySelector('select');
      return {
        description: desc ? desc.value : '',
        amount: amt ? amt.value : '',
        vatTreatment: vat ? vat.value : 'No VAT',
      };
    });
  }

  function collectInterviewData() {
    if (!formData.interviews) return;
    const sec = activeFormSections.find(s => s.multiInterview);
    if (!sec) return;
    formData.interviews.forEach((iv, idx) => {
      sec.interviewFields.forEach(f => {
        const el = document.querySelector('[data-field="iv' + idx + '_' + f.key + '"]');
        if (el) iv[f.key] = el.value;
      });
    });
  }

  function getFormData() { collectCurrentData(); return formData; }

  /* ─── SAVE ─── */
  function setListFilterAndShowList(filter) {
    listStatusFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(function(b) {
      b.classList.remove('active');
      if (b.dataset.filter === filter) b.classList.add('active');
    });
    showView('list');
    refreshList();
  }

  function saveForm(status) {
    const data = getFormData();
    if (!hasMeaningfulData(data)) {
      showToast('Nothing to save — please enter some data first', 'warning');
      return;
    }
    window.api.attendanceSave({ id: currentAttendanceId, data: data, status: status || 'draft' }).then(result => {
      if (result && typeof result === 'object' && result.error === 'locked') {
        showToast('This record is finalised and cannot be modified. Create a new attendance if needed.', 'error', 6000);
        return;
      }
      if (typeof result === 'number' || typeof result === 'string') currentAttendanceId = result;
      if (status === 'finalised') {
        currentRecordStatus = 'finalised';
        updateFormBarVisibility();
        showToast('Record finalised and saved', 'success');
        setListFilterAndShowList('finalised');
      } else {
        showToast('Saved as draft', 'success');
      }
    });
  }

  function saveAndExit() {
    const data = getFormData();
    if (hasMeaningfulData(data)) {
      window.api.attendanceSave({ id: currentAttendanceId, data: data, status: 'draft' }).then(() => {
        currentAttendanceId = null;
        stopAutoSave();
        showView('home');
      });
    } else {
      if (currentAttendanceId) window.api.attendanceDelete({ id: currentAttendanceId, reason: 'Discarded empty form' });
      currentAttendanceId = null;
      stopAutoSave();
      showView('home');
    }
  }

  /* ─── VALIDATION: TELEPHONE ADVICE FORM (INVB) ─── */
  function validateTelephoneForm() {
    var m = [];
    var required = [
      { key: 'date', label: 'Date of telephone advice', section: 0 },
      { key: 'policeStationId', label: 'Police Station', section: 0 },
      { key: 'dsccRef', label: 'DSCC Number', section: 0 },
      { key: 'instructionDateTime', label: 'Date & time instruction received', section: 0 },
      { key: 'matterTypeCode', label: 'Matter Type', section: 0 },
      { key: 'dutySolicitor', label: 'Duty Solicitor?', section: 0 },
      { key: 'feeCode', label: 'Fee Code (SaBC)', section: 0 },
      { key: 'surname', label: 'Surname', section: 1 },
      { key: 'forename', label: 'Forename', section: 1 },
      { key: 'gender', label: 'Gender', section: 1 },
      { key: 'clientPhone', label: 'Client Telephone', section: 1 },
      { key: 'timeFirstContactWithClient', label: 'Time of first contact with client', section: 1 },
      { key: 'firstContactWithin45Mins', label: 'First contact within 45 mins?', section: 1 },
      { key: 'telephoneAdviceSummary', label: 'Summary of advice given', section: 1 },
      { key: 'outcomeDecision', label: 'Outcome', section: 2 },
      { key: 'outcomeCode', label: 'Outcome Code', section: 2 },
      { key: 'caseConcludedDate', label: 'Case concluded date', section: 2 },
    ];
    required.forEach(function(r) {
      var val = formData[r.key];
      if (!val || (typeof val === 'string' && !val.trim())) m.push(r);
    });
    if (formData.firstContactWithin45Mins === 'No' && !(formData.firstContactOver45MinsReason || '').trim()) {
      m.push({ key: 'firstContactOver45MinsReason', label: 'Reason first contact exceeded 45 mins', section: 1 });
    }
    if (formData.conflictCheckResult === 'Positive' && !(formData.conflictCheckNotes || '').trim()) {
      m.push({ key: 'conflictCheckNotes', label: 'Conflict check notes', section: 1 });
    }
    if (!formData.previousAdvice) m.push({ key: 'previousAdvice', label: 'Has client received advice before?', section: 3 });
    return m;
  }

  /* ─── VALIDATION: ATTENDANCE FORM (INVC) ─── */
  function validateAttendanceForm() {
    var m = [];
    var isHandedBack = formData.outcomeDecision === 'Handed back to DSCC';
    var isNonAttendance = formData.outcomeDecision === 'Did not attend (exceptional circumstances)';
    var isRelaxedPath = isHandedBack || isNonAttendance;
    var required = [
      { key: 'date', label: 'Date', section: 0 },
      { key: 'policeStationId', label: 'Police Station', section: 0 },
      { key: 'instructionDateTime', label: 'Date & time instruction received', section: 0 },
      { key: 'surname', label: 'Surname', section: 2 },
      { key: 'forename', label: 'Forename', section: 2 },
      { key: 'dob', label: 'Date of Birth', section: 2 },
      { key: 'sufficientBenefitTest', label: 'Sufficient Benefit Test (LAA)', section: 0 },
      { key: 'conflictCheckResult', label: 'Conflict check result', section: 5 },
      { key: 'outcomeDecision', label: 'Outcome Decision', section: 7 },
      { key: 'laaClientFullName', label: 'Client Full Name (Declaration)', section: 9 },
    ];
    if (!isRelaxedPath) {
      required.push({ key: 'niNumber', label: 'NI Number', section: 5 });
      required.push({ key: 'matterTypeCode', label: 'Matter Type', section: 3 });
      required.push({ key: 'offence1Details', label: 'Offence 1 Details', section: 3 });
    }
    m = required.filter(function(r) { var val = formData[r.key]; return !val || (typeof val === 'string' && !val.trim()); });
    var workType = formData.workType || '';
    if (!isRelaxedPath && ['First Police Station Attendance', 'Further Police Station Attendance'].includes(workType)) {
      var fc = (formData.timeFirstContactWithClient || '').trim();
      var ta = (formData.timeArrival || '').trim();
      if (!fc && !ta) m.push({ key: 'timeArrival', label: 'Time of arrival / first contact (LAA 9.25)', section: 2 });
    } else if (!isRelaxedPath && !workType) {
      var fc2 = (formData.timeFirstContactWithClient || '').trim();
      var ta2 = (formData.timeArrival || '').trim();
      if (!fc2 && !ta2) m.push({ key: 'timeArrival', label: 'Time of arrival / first contact (LAA 9.25)', section: 2 });
    }
    if (formData.firstContactWithin45Mins === 'No' && !(formData.firstContactOver45MinsReason || '').trim()) {
      m.push({ key: 'firstContactOver45MinsReason', label: 'Reason first contact exceeded 45 mins', section: 0 });
    }
    if (isHandedBack && !(formData.handedBackToDSCCReason || '').trim()) m.push({ key: 'handedBackToDSCCReason', label: 'Reason handed back to DSCC', section: 7 });
    if (isNonAttendance && !(formData.nonAttendanceReason || '').trim()) m.push({ key: 'nonAttendanceReason', label: 'Reason for non-attendance', section: 7 });
    if (!formData.previousAdvice) m.push({ key: 'previousAdvice', label: 'Has client received advice on this matter before?', section: 9 });
    if (formData.previousAdvice === 'Yes' && !(formData.previousAdviceDetails || '').trim()) m.push({ key: 'previousAdviceDetails', label: 'Previous advice details', section: 9 });
    if (formData.conflictCheckResult === 'Positive' && !(formData.conflictCheckNotes || '').trim()) m.push({ key: 'conflictCheckNotes', label: 'Conflict check notes', section: 5 });
    if (formData.coSuspects === 'Yes') {
      if (!formData.coSuspectConflict) m.push({ key: 'coSuspectConflict', label: 'Conflict with co-suspect(s)?', section: 4 });
      if (formData.coSuspectConflict === 'Yes' && !(formData.coSuspectConflictNotes || '').trim()) m.push({ key: 'coSuspectConflictNotes', label: 'Co-suspect conflict notes', section: 4 });
    }
    if (formData.languageIssues === 'Yes' && !(formData.interpreterLanguage || '').trim()) m.push({ key: 'interpreterLanguage', label: 'Language required', section: 2 });
    if (formData.fmeNurse === 'Yes' && !(formData.medicalExaminationOutcome || '').trim()) m.push({ key: 'medicalExaminationOutcome', label: 'Outcome of medical examination', section: 2 });
    if (!isRelaxedPath && !(formData.disclosureType || '').trim()) m.push({ key: 'disclosureType', label: 'Disclosure Type', section: 4 });
    if ((formData.custodyNumber || '').trim() && !formData.custodyRecordRead) m.push({ key: 'custodyRecordRead', label: 'Custody record read?', section: 2 });
    if (formData.voluntaryInterview === 'No' && !(formData.groundsForArrest || '').trim()) m.push({ key: 'groundsForArrest', label: 'At least one ground for arrest', section: 2 });
    (formData.interviews || []).forEach(function(iv, idx) {
      if (!iv.cautioned) m.push({ key: 'iv' + idx + '_cautioned', label: 'Interview ' + (idx + 1) + ' \u2013 Client cautioned?', section: 6 });
    });
    if (!isRelaxedPath && !formData.clientDecision) m.push({ key: 'clientDecision', label: "Client's decision", section: 5 });
    if (formData.adviceFollowedInInterview === 'No' && !(formData.adviceFollowedExplanation || '').trim()) m.push({ key: 'adviceFollowedExplanation', label: 'Explanation when advice not followed', section: 5 });
    if (!isRelaxedPath && formData.clientDecision && !(formData.reasonsForAdvice || '').trim() && !(formData.reasonsForAdviceSelect || '').trim()) {
      if (['No comment', 'Prepared statement', 'Answer questions'].some(function(o) { return (formData.clientDecision || '').includes(o); })) {
        m.push({ key: 'reasonsForAdvice', label: 'Reasons for advice', section: 5 });
      }
    }
    var needsAA = ['Juvenile', 'Vulnerable Adult'].includes(formData.juvenileVulnerable);
    if (needsAA) {
      if (!(formData.appropriateAdultName || '').trim()) m.push({ key: 'appropriateAdultName', label: 'Appropriate Adult name', section: 2 });
      if (!(formData.appropriateAdultRelation || '').trim()) m.push({ key: 'appropriateAdultRelation', label: 'AA relationship to client', section: 2 });
      if (!(formData.appropriateAdultPhone || '').trim()) m.push({ key: 'appropriateAdultPhone', label: 'AA contact number', section: 2 });
    }
    return m;
  }

  /* ─── VALIDATION BEFORE FINALISE (#8) ─── */
  function validateBeforeFinalise() {
    collectCurrentData();
    const isTelForm = formData._formType === 'telephone';
    const missing = isTelForm ? validateTelephoneForm() : validateAttendanceForm();

    const dscc = (formData.dsccRef || '').trim().toUpperCase();
    if (dscc && (dscc.length !== 10 || dscc.charAt(9) !== 'A')) {
      missing.push({ key: 'dsccRef', label: 'DSCC Number (must be 10 chars ending in A)', section: 0 });
    }

    /* Duplicate billing check */
    const checkDuplicate = (window.api.attendanceCheckDuplicate && currentAttendanceId != null)
      ? window.api.attendanceCheckDuplicate({
          dsccRef: (formData.dsccRef || '').trim(),
          clientName: [(formData.surname || ''), (formData.forename || '')].filter(Boolean).join(', '),
          attendanceDate: formData.date || '',
          stationName: formData.policeStationName || '',
          excludeId: currentAttendanceId,
        })
      : Promise.resolve([]);

    function doFinalise() {
      const c = typeof calculateProfitCosts === 'function' && calculateProfitCosts();
      if (c && c.isEscape) {
        showConfirm('ESCAPE CASE – Total costs exceed £' + (LAA.escapeThreshold || 650) + '. You must submit CRM18 to claim at hourly rates. Continue to finalise?').then(ok => {
          if (ok) saveForm('finalised');
        });
      } else {
        saveForm('finalised');
      }
    }
    function showPreFinaliseChecklistThenFinalise() {
      const inst = formData.instructionDateTime || '—';
      const fc = (formData.timeFirstContactWithClient || formData.timeArrival || '').trim() || '—';
      const sbt = (formData.sufficientBenefitTest || '').split('|').filter(Boolean).join('; ') || '—';
      const conflict = formData.conflictCheckResult || '—';
      const outcome = formData.outcomeDecision || '—';
      const msg = 'LAA key items before finalising:\n\n' +
        '• Instruction time: ' + inst + '\n' +
        '• First contact: ' + fc + '\n' +
        '• Sufficient Benefit Test: ' + sbt + '\n' +
        '• Conflict check: ' + conflict + '\n' +
        '• Outcome: ' + outcome + '\n\nContinue to finalise?';
      showConfirm(msg, 'Pre-finalise checklist').then(ok => { if (ok) doFinalise(); });
    }
    function showValidationModal(dupes) {
      const modal = document.getElementById('validation-modal');
      const list = document.getElementById('validation-list');
      if (!modal || !list) return;
      list.innerHTML = '';
      if (dupes && dupes.length) {
        dupes.forEach(function(d) {
          const li = document.createElement('li');
          li.className = 'val-warning';
          li.innerHTML = '⚠️ <strong>Possible duplicate billing:</strong> ' + esc(d.matchReason) +
            ' — Record #' + d.id + ' (' + esc(d.client_name) + ', ' + esc(d.attendance_date) + ')';
          list.appendChild(li);
        });
      }
      missing.forEach(function(m) {
        const li = document.createElement('li');
        li.innerHTML = '<span class="val-section">S' + (m.section + 1) + ': ' + esc(activeFormSections[m.section].title.split('. ')[1] || '') + '</span>' +
          '<span class="val-field">' + esc(m.label) + '</span>';
        li.addEventListener('click', function() { modal.classList.add('hidden'); showSection(m.section); });
        list.appendChild(li);
      });
      modal.classList.remove('hidden');
    }

    checkDuplicate.then(function(dupes) {
      if (missing.length === 0 && (!dupes || !dupes.length)) { showPreFinaliseChecklistThenFinalise(); return; }
      const modal = document.getElementById('validation-modal');
      const list = document.getElementById('validation-list');
      if (!modal || !list) { doFinalise(); return; }
      showValidationModal(dupes);
    }).catch(function() {
      if (missing.length === 0) { showPreFinaliseChecklistThenFinalise(); return; }
      const modal = document.getElementById('validation-modal');
      const list = document.getElementById('validation-list');
      if (!modal || !list) { doFinalise(); return; }
      showValidationModal([]);
    });
  }

  /* ─── SECTIONS INDEX WITH PROGRESS (#7) ─── */
  function forEachVisibleSection(cb) {
    activeFormSections.forEach((sec, i) => {
      if (sec.id === 'supervisorReview' && !isSupervisorSectionEnabled()) return;
      cb(sec, i, getSectionCompletionStatus(sec));
    });
  }

  function buildSectionsIndex() {
    const ul = document.getElementById('sections-index-list');
    if (!ul) return;
    ul.innerHTML = '';
    if (!formData.sectionComplete) formData.sectionComplete = {};
    forEachVisibleSection((sec, i, status) => {
      const li = document.createElement('li');
      if (i === currentSectionIdx) li.className = 'current';

      const dot = document.createElement('span');
      dot.className = 'section-dot';
      if (formData.sectionComplete && formData.sectionComplete[i]) dot.classList.add('filled');

      li.appendChild(dot);
      li.append(' ' + sec.title);

      const tickWrap = document.createElement('span');
      tickWrap.className = 'section-tick-wrap';
      tickWrap.title = 'Mark section complete';
      const tick = document.createElement('input');
      tick.type = 'checkbox';
      tick.className = 'section-tick';
      tick.checked = !!formData.sectionComplete[i];
      tick.addEventListener('click', e => e.stopPropagation());
      tick.addEventListener('change', () => {
        formData.sectionComplete[i] = tick.checked;
        quietSave();
      });
      tickWrap.appendChild(tick);
      li.appendChild(tickWrap);

      li.addEventListener('click', () => { showSection(i); closeSectionsIndex(); });
      ul.appendChild(li);
    });
  }

  function getSectionCompletionStatus(sec) {
    const allKeys = [];
    if (sec.keyFields) allKeys.push(...sec.keyFields);
    if (!allKeys.length) {
      if (sec.checklist) allKeys.push(...sec.checklist.map(c => c.key));
      if (sec.multiInterview && formData.interviews && formData.interviews.length) {
        const iv = formData.interviews[0];
        if (iv && (iv.startTime || iv.notes)) return 'complete';
        return 'empty';
      }
    }
    if (!allKeys.length) return 'empty';
    let filled = 0;
    allKeys.forEach(k => {
      const val = formData[k];
      if (val && (typeof val !== 'string' || val.trim())) filled++;
    });
    if (filled === allKeys.length) return 'complete';
    if (filled > 0) return 'partial';
    return 'empty';
  }

  function openSectionsIndex() { document.getElementById('sections-index')?.classList.remove('hidden'); buildSectionsIndex(); }
  function closeSectionsIndex() { document.getElementById('sections-index')?.classList.add('hidden'); }

  var sectionShortLabels = {
    caseArrival: 'Ref', journeyTime: 'Journey', custody: 'Custody', offences: 'Offences',
    disclosure: 'Disclosure', attend: 'Consult', interview: 'Interview',
    outcome: 'Outcome',
    timeRecording: 'Fees',
    telCallDetails: 'Call', telClientAdvice: 'Advice', telOutcome: 'Outcome', telSignOff: 'Sign off'
  };

  function buildSectionIndexBar() {
    const container = document.getElementById('section-index-bar');
    if (!container) return;
    container.innerHTML = '';
    forEachVisibleSection((sec, i, status) => {
      const num = i + 1;
      const label = sectionShortLabels[sec.id] || sec.title.replace(/^[\d.]+\s*/, '').slice(0, 12);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'section-index-btn';
      btn.title = sec.title;
      if (i === currentSectionIdx) btn.classList.add('current');
      if (formData.sectionComplete && formData.sectionComplete[i]) btn.classList.add('filled');
      btn.innerHTML = '<span class="sec-num">' + num + '</span> ' + esc(label);
      btn.addEventListener('click', () => showSection(i));
      container.appendChild(btn);
    });
  }

  function updateProgressBar() {
    var bars = [document.getElementById('section-progress-bar'), document.getElementById('section-progress-bar-2')];
    bars.forEach(function(bar) {
      if (!bar) return;
      bar.innerHTML = '';
      forEachVisibleSection(function(sec, i) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'prog-dot';
        dot.title = sec.title;
        if (formData.sectionComplete && formData.sectionComplete[i]) dot.classList.add('filled');
        if (i === currentSectionIdx) dot.classList.add('current');
        dot.addEventListener('click', function() { showSection(i); });
        bar.appendChild(dot);
      });
    });
    buildSectionIndexBar();
  }

  /* ═══════════════════════════════════════════════
     PDF GENERATION – comprehensive LAA-compliant
     ═══════════════════════════════════════════════ */
  /* Free-trial advert last page – keep in sync with index.html splash-advert */
  var PDF_CASENOTE_ADVERT = '<div style="margin-top:32px;padding:12px 16px;border-top:1px solid #e2e8f0;text-align:center;font-size:9px;color:#94a3b8;">Created with <strong style="color:#2563eb;">Custody Note</strong> &mdash; Fast, compliant police-station attendance notes. <a href="https://www.custodynote.com" style="color:#2563eb;">www.custodynote.com</a> | <a href="mailto:robertcashman@defencelegalservices.com" style="color:#2563eb;">robertcashman@defencelegalservices.com</a></div>';
  function formatInstructionDateTime(val) {
    if (!val || typeof val !== 'string') return '';
    var s = val.trim();
    if (s.length >= 16 && s[10] === 'T') {
      var datePart = s.slice(0, 10);
      var timePart = s.slice(11, 16);
      var parts = datePart.split('-');
      if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0] + ' ' + timePart;
    }
    return s;
  }
  function fmtDate(val) {
    if (!val) return '';
    var s = String(val).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    return s;
  }
  function buildPdfHtml(d, settings) {
    const h = esc;
    const row = (l, v) => v ? '<tr><td class="l">' + h(l) + '</td><td>' + h(String(v)) + '</td></tr>' : '';
    const check = (k, l) => d[k] ? '<span class="chk">\u2611 ' + h(l) + '</span>' : '<span class="chk unc">\u2610 ' + h(l) + '</span>';
    const sig = k => d[k] ? '<img src="' + d[k] + '" class="sig-img" alt="">' : '<em class="sig-unsigned">Not signed</em>';
    const sn = d.policeStationName || '';
    const firmName = d.firmName || '';
    const brand = (settings.brandName || 'Defence Legal Services Ltd') + (settings.tradingAs ? ' t/a ' + settings.tradingAs : '');
    const codeLookup = (key, code) => { const arr = refData[key] || []; const item = arr.find(c => c.code === code); return item ? code + ' \u2013 ' + item.description : code || ''; };

    let ivHtml = '';
    const interviewList = d.interviews || [];
    if (interviewList.length) {
      ivHtml += '<p class="decl" style="margin-bottom:8px;font-size:9px;color:#b91c1c;">These notes are not verbatim and should not be relied upon as if a transcript.</p>';
    }
    interviewList.forEach((iv, idx) => {
      ivHtml += '<h2>7. Interview ' + (idx + 1) + '</h2><table>' +
        row('Start', iv.startTime) + row('End', iv.endTime) + row('Present', iv.present) + row('Cautioned', iv.cautioned) +
        '</table>' + (iv.notes ? '<div class="nar">' + h(iv.notes) + '</div>' : '');
    });

    const clientNameForTitle = [d.forename, d.surname].filter(Boolean).join(' ') || '—';
    const myRefForTitle = d.ourFileNumber || d.fileReference || '—';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + h(clientNameForTitle) + ' | ' + h(myRefForTitle) + '</title><style>' +
'@page{margin:15mm;size:A4;}' +
'body{font-family:\'Segoe UI\',\'Helvetica Neue\',Arial,sans-serif;font-size:11px;padding:20px 24px 56px;color:#111;line-height:1.45;max-width:100%;}' +
'@media print{.pdf-section,.fee-box,.decl-box,.nar,.cover-block{page-break-inside:avoid;}h2{print-color-adjust:exact;}.pdf-break-before{page-break-before:always;}.watermark{print-color-adjust:exact;}}' +
'.pdf-break-before{page-break-before:always;}' +
'h1{font-size:18px;font-weight:700;color:#2563eb;margin:0 0 8px;letter-spacing:-0.02em;}' +
'h2{font-size:12px;font-weight:700;margin:24px 0 8px;padding:8px 10px;background:#eef2ff;color:#1e40af;border-radius:4px;border-left:4px solid #2563eb;border-top:1px solid #e2e8f0;padding-top:16px;print-color-adjust:exact;}' +
'.pdf-section{page-break-inside:avoid;}' +
'table{width:100%;border-collapse:collapse;margin-bottom:8px;}' +
'td{padding:6px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;}' +
'tr:nth-child(even) td{background:#f8fafc;print-color-adjust:exact;}' +
'.l{color:#475569;width:40%;font-weight:500;word-break:break-word;}' +
'.chk{display:inline-block;font-size:9px;margin:2px 4px 2px 0;padding:3px 8px;border-radius:12px;background:#d1fae5;color:#065f46;font-weight:600;print-color-adjust:exact;}' +
'.unc{background:transparent;border:1px solid #cbd5e1;color:#94a3b8;font-weight:400;}' +
'.chk-list{list-style:none;padding:0;margin:6px 0;display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;}' +
'.chk-list li{break-inside:avoid;}' +
'.chk{display:block;}' +
'.nar{white-space:pre-wrap;font-size:10px;background:#f8fafc;padding:8px 10px 8px 13px;border-radius:4px;margin:6px 0;border:1px solid #e2e8f0;border-left:3px solid #2563eb;line-height:1.55;}' +
'.letterhead{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:12px;padding:8px 0 10px;border-bottom:1px solid #e2e8f0;margin:0 0 10px;}' +
'.lh-left{font-size:10px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
'.lh-center{font-size:11px;font-weight:800;letter-spacing:0.08em;color:#1e40af;text-transform:uppercase;}' +
'.lh-right{font-size:9px;color:#475569;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
'.fee-box{border:2px solid #2563eb;border-radius:8px;padding:10px;margin:10px 0;background:#f0f4ff;print-color-adjust:exact;}' +
'.fee-box table td{border:none;padding:4px 8px;} .fee-box .r{text-align:right;}' +
'.escape-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-weight:700;font-size:10px;margin-top:4px;}' +
'.escape-yes{background:#fecaca;color:#991b1b;} .escape-no{background:#d1fae5;color:#065f46;}' +
'.decl-box{font-size:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 12px;margin:10px 0;white-space:pre-wrap;print-color-adjust:exact;}' +
'.sig-block{margin:10px 0;}' +
'.sig-block .sig-label{font-size:10px;font-weight:600;margin-bottom:4px;color:#334155;}' +
'.sig-img{max-width:320px;max-height:90px;display:block;}' +
'.sig-unsigned{font-style:italic;color:#64748b;}' +
'.cover-block{background:#f0f4ff;border:1px solid #c7d2fe;border-radius:8px;padding:12px 16px;margin:10px 0 16px;display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;print-color-adjust:exact;}' +
'.cover-item{font-size:10px;line-height:1.4;}.cover-item strong{color:#1e40af;}' +
'.watermark{position:fixed;top:30%;left:5%;font-size:110px;font-weight:900;color:rgba(0,0,0,0.04);transform:rotate(-30deg);pointer-events:none;z-index:0;letter-spacing:12px;print-color-adjust:exact;}' +
'</style></head><body>' +
'<div class="letterhead">' +
'<div class="lh-left">' + h(brand) + '</div>' +
'<div class="lh-center">Custody Note</div>' +
'<div class="lh-right">Ref ' + h(d.ourFileNumber || d.fileReference || '\u2014') + (d.date ? (' \u00B7 ' + h(fmtDate(d.date))) : '') + '</div>' +
'</div>' +
'<h1>Custody Note</h1>' +
'<p style="font-size:10px;color:#475569;">' +
'  <strong>File number (ours) / Invoice no.:</strong> ' + h(d.ourFileNumber || d.fileReference || '') + ' &middot; <strong>Date:</strong> ' + h(fmtDate(d.date)||'') + ' &middot; <strong>DSCC PIN:</strong> ' + h(settings.dsccPin||'') +
  (firmName ? ' &middot; <strong>Firm:</strong> ' + h(firmName) : '') +
  (d.firmLaaAccount ? ' &middot; <strong>LAA Acct:</strong> ' + h(d.firmLaaAccount) : '') +
'</p>' +
'<div class="cover-block">' +
'<div class="cover-item"><strong>Client:</strong> ' + h([d.forename, d.surname].filter(Boolean).join(' ') || '\u2014') + '</div>' +
'<div class="cover-item"><strong>Station:</strong> ' + h(sn || '\u2014') + '</div>' +
'<div class="cover-item"><strong>Date:</strong> ' + h(fmtDate(d.date) || '\u2014') + '</div>' +
'<div class="cover-item"><strong>DSCC number:</strong> ' + h(d.dsccRef || '\u2014') + '</div>' +
'<div class="cover-item"><strong>Offence:</strong> ' + h(d.offenceSummary || '\u2014') + '</div>' +
'<div class="cover-item"><strong>Custody no.:</strong> ' + h(d.custodyNumber || '\u2014') + '</div>' +
'</div>' +
(d.feeEarnerCertification !== 'Finalised' ? '<div class="watermark">CUSTODY NOTE</div>' : '') +

'<h2>1. Case Reference & Arrival</h2><table>' +
row('Instruction received', formatInstructionDateTime(d.instructionDateTime)) + row('Firm', firmName) +
row('Firm contact', d.firmContactName) + row('Contact phone', d.firmContactPhone) + row('Contact email', d.firmContactEmail) +
row('Client first name', d.forename) + row('Client surname', d.surname) + row('File number (ours) / Invoice no.', d.ourFileNumber || d.fileReference) + row('Offence (summary)', d.offenceSummary) +
row('Station', sn) + row('DSCC number', d.dsccRef) +
row('Officer in Charge', d.oicName) + row('Officer in Charge email', d.oicEmail) + row('Officer in Charge telephone', d.oicPhone) +
row('Date', fmtDate(d.date)) + row('Weekend/Bank Holiday', d.weekendBankHoliday) + row('Other Location', d.otherLocation) +
row('Referral', d.sourceOfReferral) + row('Work Type', d.workType) + row('Telephone advice given?', d.telephoneAdviceGiven) + row('Fee Earner (telephone advice)', d.feeEarnerTelephoneAdvice) +
row('Scheme ID', d.schemeId) + row('Duty Solicitor', d.dutySolicitor) +
row('Client Status', d.clientStatus) + row('Case Status', d.caseStatus) +
row('Time first contact (LAA 9.25)', d.timeFirstContactWithClient) + row('First contact within 45 mins?', d.firstContactWithin45Mins) + (d.firstContactOver45MinsReason ? row('Reason first contact >45 mins', d.firstContactOver45MinsReason) : '') +
row('Sufficient Benefit Test', (d.sufficientBenefitTest || '').split('|').filter(Boolean).join('; ')) + (d.sufficientBenefitNotes ? row('Sufficient Benefit Test notes', d.sufficientBenefitNotes) : '') +
(d.telephoneAdviceSummary ? row('Summary of advice given (telephone)', d.telephoneAdviceSummary) : '') +
'</table>' +
(d.arrivalNotes ? '<div class="nar">' + h(d.arrivalNotes) + '</div>' : '') +

'<h2>2. Journey to Station</h2><table>' +
row('Already at station?', d.alreadyAtStation) + row('Travel from', d.travelOriginPostcode) +
row('Time set off', d.timeSetOff) + row('Time arrival at station', d.timeArrival) +
'</table>' +

'<h2>3. Custody Record</h2><table>' +
row('Custody number', d.custodyNumber) + row('Custody record read?', d.custodyRecordRead) +
row('Client (from record)', [d.title, d.forename, d.middleName, d.surname].filter(Boolean).join(' ')) +
row('Date of birth', fmtDate(d.dob)) + row('Gender', d.gender) + row('Nationality', d.nationality === 'Other' ? d.nationalityOther : d.nationality) +
row('Address', [d.address1, d.address2, d.address3, d.city, d.county, d.postCode].filter(Boolean).join(', ')) +
row('Custody record issues', d.custodyRecordIssues) +
row('Arresting officer', d.arrestingOfficerName) + row('Arresting officer collar / badge no.', d.arrestingOfficerNumber) +
row('Voluntary Interview', d.voluntaryInterview) +
row('Grounds for arrest', (d.groundsForArrest || '').replace(/\|/g, ', ')) + row('Grounds for detention', (d.groundsForDetention || '').replace(/\|/g, ', ')) +
row('Date of arrest', fmtDate(d.dateOfArrest)) + row('Time of arrest', d.timeOfArrest) + row('Arrival at station', d.timeArrivalStation) +
row('Relevant Time', d.relevantTime) + row('Detention authorised (time)', d.timeDetentionAuthorised) +
row('First review due', d.firstReviewDue) + row('First review actual', d.firstReviewActual) + row('First review notes', d.firstReviewNotes) +
row('Second review due', d.secondReviewDue) + row('Second review actual', d.secondReviewActual) + row('Second review notes', d.secondReviewNotes) +
row('Third review due', d.thirdReviewDue) + row('Third review actual', d.thirdReviewActual) + row('Third review notes', d.thirdReviewNotes) +
row('Language Issues', d.languageIssues) + row('Interpreter', d.interpreterName) + row('Language', d.interpreterLanguage) +
row('Juvenile / Vulnerable', d.juvenileVulnerable) + row('Appropriate adult', d.appropriateAdultName) + row('Appropriate adult relationship', d.appropriateAdultRelation) +
row('Appropriate adult telephone', d.appropriateAdultPhone) + row('Appropriate adult email', d.appropriateAdultEmail) +
row('Appropriate adult organisation', d.appropriateAdultOrganisation) + (d.appropriateAdultAddress ? row('Appropriate adult address', d.appropriateAdultAddress) : '') +
row('Injuries', d.injuriesToClient) + row('Injury Details', d.injuryDetails) + row('Photos of injuries requested?', d.photosOfInjuriesRequested) +
row('Medication', d.medication) + row('Psychiatric/mental health issues?', d.psychiatricIssues) + row('Psychiatric notes', d.psychiatricNotes) +
row('Literate/can read?', d.literate) + row('Drugs test', d.drugsTest) + row('FME / Nurse / Doctor', d.fmeNurse) + (d.medicalExaminationOutcome ? row('Medical examination outcome', d.medicalExaminationOutcome) : '') +
row('Fit to be detained?', d.fitToBeDetained) + row('Fit to be interviewed?', d.fitToBeInterviewed) +
'</table>' +

'<h2>4. Offences</h2><table>' +
row('Matter Type', codeLookup('matterTypeCodes', d.matterTypeCode)) +
row('Offence 1', d.offence1Details) + row('Date', fmtDate(d.offence1Date)) + row('Mode', codeLookup('modeOfTrial', d.offence1ModeOfTrial)) + row('Statute', d.offence1Statute) +
row('Offence 2', d.offence2Details) + row('Date', fmtDate(d.offence2Date)) + row('Mode', codeLookup('modeOfTrial', d.offence2ModeOfTrial)) + row('Statute', d.offence2Statute) +
row('Offence 3', d.offence3Details) + row('Date', fmtDate(d.offence3Date)) + row('Mode', codeLookup('modeOfTrial', d.offence3ModeOfTrial)) + row('Statute', d.offence3Statute) +
row('Offence 4', d.offence4Details) + row('Date', fmtDate(d.offence4Date)) + row('Mode', codeLookup('modeOfTrial', d.offence4ModeOfTrial)) + row('Statute', d.offence4Statute) +
row('Other offences (notes)', d.otherOffencesNotes) +
'</table>' +

'<h2>5. Disclosure</h2><table>' +
row('Type', d.disclosureType) + row('Disclosure officer is OIC?', d.disclosureOfficerIsOIC) +
(d.disclosureOfficerIsOIC === 'No' ?
  row('Disclosure officer', d.disclosureOfficerName) + row('Disclosure officer email', d.disclosureOfficerEmail) + row('Disclosure officer telephone', d.disclosureOfficerPhone) + row('Disclosure officer unit', d.disclosureOfficerUnit) :
  row('Officer in Charge', d.oicName) + row('Officer in Charge email', d.oicEmail) + row('Officer in Charge telephone', d.oicPhone) + row('Officer in Charge unit', d.oicUnit)) +
row('Statements', d.significantStatements) +
row('Evidence against client (signed)', d.clientSignedEAB) + row('Co-suspects', d.coSuspects) + row('Names of co-suspects/co-defendants', d.coSuspectDetails) + row('Conflict with co-suspect(s)?', d.coSuspectConflict) + (d.coSuspectConflictNotes ? row('Conflict notes', d.coSuspectConflictNotes) : '') +
row('Complainant', d.nameOfComplainant) + row('Prosecution witnesses?', d.prosecutionWitnesses) + row('Witness intimidation?', d.witnessIntimidation) +
row('CCTV/BWV/visual?', d.cctvVisual) + row('CCTV viewed?', d.cctvViewed) + row('CCTV Notes', d.cctvNotes) +
row('Written evidence?', d.writtenEvidence) + (d.writtenEvidenceDetails ? row('Written evidence details', d.writtenEvidenceDetails) : '') +
row('Exhibits to inspect?', d.exhibitsToInspect) + row('Exhibits inspected?', d.exhibitsInspected) + (d.exhibitsNotes ? row('Exhibits notes', d.exhibitsNotes) : '') +
row('PNC/pre-cons disclosed?', d.pncDisclosed) + (d.pncNotes ? row('Previous convictions (details)', d.pncNotes) : '') +
    ((d.paceSearches && d.paceSearches.length) ? d.paceSearches.filter(function(ps) { return (ps.searchType || '').trim() || (ps.whatFound || '').trim(); }).map(function(ps, i) { return row('PACE search ' + (i + 1), (ps.searchType || '') + (ps.whatFound ? ': ' + ps.whatFound : '')); }).join('') : '') +
    row('Samples (disclosed)?', d.samplesDisclosed) +
    ((d.forensicSamples && d.forensicSamples.length) ? d.forensicSamples.map(function(fs, i) { return row('Forensic sample ' + (i + 1), (fs.sampleType || '') + (fs.whatDone ? ' \u2013 ' + fs.whatDone : '') + (fs.notes ? ' (' + fs.notes + ')' : '')); }).join('') : '') +
row('Caution/out-of-court offered?', d.cautionAvailable) + row('Clothing/shoes/phone seized?', d.clothingShoesSeized) +
row('Injuries (disclosure)', d.disclosureReInjuries) +
((d.attendingContacts && d.attendingContacts.length) ? d.attendingContacts.filter(function(c) { return (c.contactType || c.time || c.outcome || c.notes); }).map(function(c, i) { return row('Contact ' + (i + 1) + ' (who)', c.contactType || '—') + row('Contact ' + (i + 1) + ' (time)', c.time || '—') + row('Contact ' + (i + 1) + ' (outcome)', c.outcome || '—') + (c.notes ? row('Contact ' + (i + 1) + ' (notes)', c.notes) : ''); }).join('') : (d.attendingContactType ? row('Who contacted', d.attendingContactType) + row('Time of contact', d.attendingContactTime) + row('Outcome', d.attendingContactOutcome) : '')) +
'</table>' + (d.disclosureNarrative ? '<div class="nar">' + h(d.disclosureNarrative) + '</div>' : '') +
(!(d.attendingContacts && d.attendingContacts.length) && d.attendingOthersNotes ? '<div class="nar">' + h(d.attendingOthersNotes) + '</div>' : '') +

'<h2>6. Consultation (Attend on Client)</h2>' +
'<ul class="chk-list">' +
'<li>' + check('chkConflictCheck', 'Conflict of interest check completed') + '</li>' +
'<li>' + check('chkConfidentiality', 'Advised on confidentiality') + '</li>' +
'<li>' + check('chkIndependence', 'Advised independence of legal advice') + '</li>' +
'<li>' + check('chkFreeRep', 'Advised free representation') + '</li>' +
'<li>' + check('chkWelfare', 'Checked client welfare') + '</li>' +
'<li>' + check('chkDontDiscuss', 'Advised not to discuss case with anyone') + '</li>' +
'<li>' + check('chkDontSign', 'Advised not to sign anything without legal advice') + '</li>' +
'<li>' + check('chkUnderstands', 'Client understands advice given') + '</li>' +
'<li>' + check('chkPersonalData', 'Confirmed personal data on custody record') + '</li>' +
'<li>' + check('chkReasonForArrest', 'Explained reason for arrest') + '</li>' +
'<li>' + check('chkDisclosure', 'Explained disclosure') + '</li>' +
'</ul>' +
'<table>' + row('Conflict check result', d.conflictCheckResult) + row('Conflict check notes', d.conflictCheckNotes) +
row('Type', d.clientType) + row('National Insurance number', d.niNumber) + row('Application Registration Card number', d.arcNumber) +
row('Benefits', d.benefits) + row('Benefit Type', d.benefitType === 'Other' ? d.benefitOther : d.benefitType) + row('Benefit Notes', d.benefitNotes) +
row('Passported Benefit', d.passportedBenefit) + row('Gross Income', d.grossIncome) + row('Partner Income', d.partnerIncome) + row('Partner name', d.partnerName) + row('Income Notes', d.incomeNotes) +
row('Employment', d.employmentStatus) + row('Accommodation', d.accommodationStatus) + (d.accommodationDetails ? row('Accommodation notes', d.accommodationDetails) : '') + row('Marital status', d.maritalStatus) +
row('Phone', d.clientPhone) + row('Email', d.clientEmail) +
row('Ethnicity', codeLookup('ethnicCodes', d.ethnicOriginCode)) + row('Disability', codeLookup('disabilityCodes', d.disabilityCode)) + row('Risk', d.riskAssessment) +
row('Sufficient Benefit Test (LAA)', (d.sufficientBenefitTest || '').split('|').filter(Boolean).join('; ')) + row('Sufficient Benefit Test notes', d.sufficientBenefitNotes) + row('Gaps', d.gapsInEvidence) + row('Case assessment (police case)', d.caseAssessment) + row('Sentence', d.likelySentence) + '</table>' +
(d.lawElements ? '<div class="nar">' + h(d.lawElements) + '</div>' : '') + (d.clientInstructions ? '<p style="font-size:9px;font-weight:600;margin:8px 0 4px;">Summary of client instructions</p><div class="nar">' + h(d.clientInstructions) + '</div>' : '') +
'<p style="font-size:9px;font-weight:600;">Advice:</p>' +
'<ul class="chk-list">' +
'<li>' + check('advSilence', 'Right to Silence & Inferences Explained') + '</li>' +
'<li>' + check('advCaution', 'Caution Explained') + '</li>' +
'<li>' + check('advConsequences', 'Consequences of lying / different version later') + '</li>' +
'<li>' + check('advBadCharacter', 'Bad Character') + '</li>' +
'<li>' + check('advSpecialWarning', 'Special Warning Explained') + '</li>' +
'<li>' + check('advInterviewProcedure', 'Interview Procedure Explained') + '</li>' +
'<li>' + check('advRights', 'Rights: Answer / No Answer / Prepared statement') + '</li>' +
'<li>' + check('advStopInterview', 'Right to Stop Interview for advice') + '</li>' +
'<li>' + check('advIDProcedures', 'ID procedures explained') + '</li>' +
'<li>' + check('advCourtProcedure', 'Court procedure explained') + '</li>' +
'<li>' + check('advAlibis', 'Alibis discussed') + '</li>' +
'<li>' + check('advFailureToAttendBail', 'Failure to attend bail explained') + '</li>' +
'</ul>' +
'<table>' + row('Advice re interview', d.adviceReInterview) + row('Reason (quick)', d.reasonsForAdviceSelect) + row('Reasons (detail)', d.reasonsForAdvice) + row('Decision', d.clientDecision) + row('Advice followed in interview?', d.adviceFollowedInInterview) + (d.adviceFollowedExplanation ? row('If not followed – explanation', d.adviceFollowedExplanation) : '') + row('Advice re complaint given?', d.adviceReComplaint) + '</table>' +
(d.repInstructionsSig || d.clientInstructionsSig ? '<div class="sig-block"><p class="sig-label">Rep confirmation of instructions</p>' + sig('repInstructionsSig') + '</div><div class="sig-block"><p class="sig-label">Client confirmation of instructions</p>' + sig('clientInstructionsSig') + '</div>' : '') +

(ivHtml || '') +

'<h2>8. Outcome</h2>' +
(d.outcomeDecision ? '<p style="font-size:10px;font-weight:600;">Outcome: ' + h(d.outcomeDecision) + '</p>' : '') +
'<table>' +
row('Decision', d.outcomeDecision) +
(function() { var isCharged = (d.outcomeDecision || '').indexOf('Charged') >= 0; var lbl = isCharged ? 'Charge' : 'Offence'; return [1,2,3,4].map(function(n) { var det = d['outcomeOffence' + n + 'Details']; return det ? row(lbl + ' ' + n, det) + row(lbl + ' ' + n + ' statute', d['outcomeOffence' + n + 'Statute']) : ''; }).join(''); })() +
(d.outcomeDecision === 'Bail without charge' ? (row('Date to return', fmtDate(d.bailDate)) + row('Time to return', d.bailReturnTime) + row('Police station to return to (name)', d.bailReturnStationName || d.policeStationName) + row('Police station to return to (code)', d.bailReturnStationCode || d.schemeId)) : row('Bail date', fmtDate(d.bailDate))) +
row('Bail type', d.bailType) +
(function() {
  var bcd = d.bailConditionsData;
  if (typeof bcd === 'string') { try { bcd = JSON.parse(bcd); } catch (_) { bcd = null; } }
  if (bcd && typeof bcd === 'object') {
    var lines = [];
    var BAIL_LABELS = { residence:'Residence',curfew:'Curfew',reportToStation:'Report to police station',surrenderPassport:'Surrender passport / travel documents',noContactVictim:'No contact with victim(s)',noContactWitness:'No contact with witnesses / co-accused',exclusionZone:'Not to enter specified area / address',noContactChildren:'No contact with children',electronicTag:'Electronic monitoring (tag)',surety:'Surety / security',other:'Other' };
    Object.keys(BAIL_LABELS).forEach(function(k) {
      var v = bcd[k];
      if (v && v.checked) lines.push(row(BAIL_LABELS[k], v.detail || 'Yes'));
    });
    return lines.length ? lines.join('') : '';
  }
  if (d.bailConditionsChecklist) return row('Bail conditions', d.bailConditionsChecklist.replace(/\|/g, '; ')) + (d.bailConditions ? row('Bail conditions details', d.bailConditions) : '');
  return '';
})() +
row('Court', d.courtName) + row('Court date', fmtDate(d.courtDate)) +
row('Next location', d.nextLocationName) + row('Next date', fmtDate(d.nextDate)) + row('Further attendance', d.furtherAttendance) +
(d.handedBackToDSCCReason ? row('Reason handed back to DSCC (Spec 9.53)', d.handedBackToDSCCReason) : '') +
(d.nonAttendanceReason ? row('Reason for non-attendance (Spec 9.39/9.44)', d.nonAttendanceReason) : '') +
'</table>' +

'<h2>9. Time Recording & Fees</h2><table>' +
row('Time departure from station', d.timeDeparture) + row('Time arrival office/home', d.timeOfficeHome) +
row('Multiple journeys', d.multipleJourneys) + row('Waiting time start', d.waitingTimeStart) + row('Waiting time end', d.waitingTimeEnd) + row('Waiting time notes', d.waitingTimeNotes) +
row('Travel – social (mins)', d.travelSocial) + row('Travel – unsocial (mins)', d.travelUnsocial) +
row('Waiting – social (mins)', d.waitingSocial) + row('Waiting – unsocial (mins)', d.waitingUnsocial) +
row('Attendance & Advice – social (mins)', d.adviceSocial) + row('Attendance & Advice – unsocial (mins)', d.adviceUnsocial) +
row('Total minutes', d.totalMinutes) + row('Miles claimable (45p)', d.milesClaimable) + row('Parking cost', d.parkingCost) +
((d.disbursements && d.disbursements.length) ? d.disbursements.filter(function(dis) { return (dis.description || '').trim() || (parseFloat(dis.amount) > 0); }).map(function(dis, i) { return row('Disbursement ' + (i + 1), (dis.description || '') + ' \u2013 \u00A3' + (dis.amount || '0') + ' (' + (dis.vatTreatment || 'No VAT') + ')'); }).join('') || '' : '') +
row('Number of suspects', d.numSuspects) + row('No. Attendances', d.numAttendances) + row('Case stage', d.caseStage) +
row('Date police station finalised', fmtDate(d.policeStationFinalisedDate)) + row('Time police station finalised', d.policeStationFinalisedTime) +
row('Invoice sent?', d.invoiceSent) + (d.invoiceSent === 'Yes' ? row('Invoice sent date', fmtDate(d.invoiceSentDate)) + row('Invoice sent time', d.invoiceSentTime) : '') + row('Invoice notes', d.invoiceNotes) +
'</table>' +
(d.repConfirmationSig ? '<div class="sig-block"><p class="sig-label">Rep confirmation</p>' + sig('repConfirmationSig') + '</div>' : '') +
(d.notesToOffice ? '<div class="nar">' + h(d.notesToOffice) + '</div>' : '') +

(function() {
  function hasAny(keys) {
    return (keys || []).some(function(k) {
      var v = d[k];
      if (v == null) return false;
      if (typeof v === 'string') return !!v.trim();
      return true;
    });
  }
  var capKeys = [
    'vidCapRecordingType','vidCapRecordingTypeOther','vidCapStartTime','vidCapEndTime','vidCapLocation','vidCapRoom','vidCapBreaks',
    'vidCapInterviewingOfficers','vidCapOthersPresent','vidCapMediaRef','vidCapMasterWorkingCopy','vidCapExhibitRef','vidCapSealedBy','vidCapSealedTime',
    'vidCapContinuityNotes','vidCapMalfunction','vidCapMalfunctionNotes','vidCapDefenceCopyRequested','vidCapDefenceCopyRequestedDate',
    'vidCapDefenceCopyProvidedDate','vidCapDefenceCopyNotes','vidCapNotes'
  ];
  var paradeKeys = [
    'vidParadeType','vidParadeTypeOther','vidParadeDate','vidParadeTime','vidParadeLocation','vidParadeConductingOfficer',
    'vidParadeClientPosition','vidParadeFoilsCount','vidParadeSolicitorPresent','vidParadeObjections','vidParadeResult','vidParadeNotes'
  ];
  var capHas = hasAny(capKeys);
  var paradeHas = hasAny(paradeKeys);
  if (!capHas && !paradeHas) return '';

  var out = '';
  if (capHas) {
    var capType = d.vidCapRecordingType === 'Other' ? (d.vidCapRecordingTypeOther || 'Other') : d.vidCapRecordingType;
    out += '<h2 class="pdf-break-before">Appendix A: Video Capture</h2>' +
      '<table>' +
        row('Recording type', capType) +
        row('Start time', d.vidCapStartTime) + row('End time', d.vidCapEndTime) +
        row('Location', d.vidCapLocation) + row('Room', d.vidCapRoom) +
        row('Interviewing officer(s)', d.vidCapInterviewingOfficers) +
        row('Others present', d.vidCapOthersPresent) +
        row('Unique reference (URN / disc / file ref)', d.vidCapMediaRef) +
        row('Master / working copy process noted?', d.vidCapMasterWorkingCopy) +
        row('Exhibit reference', d.vidCapExhibitRef) +
        row('Sealed by', d.vidCapSealedBy) + row('Time sealed', d.vidCapSealedTime) +
        row('Malfunction / failure to record?', d.vidCapMalfunction) +
        row('Defence copy requested?', d.vidCapDefenceCopyRequested) +
        (d.vidCapDefenceCopyRequested === 'Yes' ? row('Date copy requested', fmtDate(d.vidCapDefenceCopyRequestedDate)) + row('Date copy provided', fmtDate(d.vidCapDefenceCopyProvidedDate)) : '') +
      '</table>' +
      (d.vidCapBreaks ? '<p style="font-size:9px;font-weight:600;margin:8px 0 4px;">Breaks / interruptions</p><div class="nar">' + h(d.vidCapBreaks) + '</div>' : '') +
      (d.vidCapContinuityNotes ? '<p style="font-size:9px;font-weight:600;margin:8px 0 4px;">Continuity notes</p><div class="nar">' + h(d.vidCapContinuityNotes) + '</div>' : '') +
      (d.vidCapMalfunction === 'Yes' && d.vidCapMalfunctionNotes ? '<p style="font-size:9px;font-weight:600;margin:8px 0 4px;">Malfunction / remedy</p><div class="nar">' + h(d.vidCapMalfunctionNotes) + '</div>' : '') +
      (d.vidCapDefenceCopyRequested === 'Yes' && d.vidCapDefenceCopyNotes ? '<p style="font-size:9px;font-weight:600;margin:8px 0 4px;">Defence copy notes</p><div class="nar">' + h(d.vidCapDefenceCopyNotes) + '</div>' : '') +
      (d.vidCapNotes ? '<p style="font-size:9px;font-weight:600;margin:8px 0 4px;">Notes</p><div class="nar">' + h(d.vidCapNotes) + '</div>' : '');
  }

  if (paradeHas) {
    var pType = d.vidParadeType === 'Other' ? (d.vidParadeTypeOther || 'Other') : d.vidParadeType;
    out += '<h2 class="pdf-break-before">Appendix B: Video Identification Parade</h2>' +
      '<table>' +
        row('Parade type', pType) +
        row('Date', fmtDate(d.vidParadeDate)) + row('Time', d.vidParadeTime) +
        row('Location', d.vidParadeLocation) +
        row('Conducting officer', d.vidParadeConductingOfficer) +
        row('Suspect/client position', d.vidParadeClientPosition) +
        row('Number of foils', d.vidParadeFoilsCount) +
        row('Solicitor / rep present throughout?', d.vidParadeSolicitorPresent) +
        row('Result', d.vidParadeResult) +
      '</table>' +
      (d.vidParadeObjections ? '<p style="font-size:9px;font-weight:600;margin:8px 0 4px;">Objections / procedural concerns</p><div class="nar">' + h(d.vidParadeObjections) + '</div>' : '') +
      (d.vidParadeNotes ? '<p style="font-size:9px;font-weight:600;margin:8px 0 4px;">Notes</p><div class="nar">' + h(d.vidParadeNotes) + '</div>' : '');
  }

  return out;
})() +

(function() {
  var laaRows = row('Previous advice?', d.previousAdvice) + row('Details', d.previousAdviceDetails) +
    row('Privacy Notice', d.privacyNoticeAccepted) +
    row('Client name', d.laaClientFullName) + row('Date', fmtDate(d.laaSignatureDate)) + row('Time', d.laaSignatureTime) +
    row('Fee Earner', d.laaFeeEarnerFullName) + row('Certification', d.feeEarnerCertification);
  var hasSig = d.clientSig || d.feeEarnerSig;
  if (!laaRows && !hasSig) return '';
  return '<h2 class="pdf-break-before">10. LAA Declaration</h2>' +
    ((d.workType === 'Police Station Telephone Attendance' || (d.sufficientBenefitTest && d.sufficientBenefitTest.split('|').indexOf('Telephone advice only') >= 0)) ? '<p style="font-size:10px;color:#64748b;margin-bottom:8px;"><em>For telephone advice only: client may sign declaration later if not present; note on file if declaration is to follow.</em></p>' : '') +
    '<div class="decl-box">' + h(refData.laaDeclarationText || '') + '</div>' +
    '<table>' + laaRows + '</table>' +
    '<div class="sig-block"><p class="sig-label">Client signature</p>' + sig('clientSig') + '</div>' +
    '<div class="sig-block"><p class="sig-label">Fee earner signature</p>' + sig('feeEarnerSig') + '</div>';
})() +

(function() {
  var adminRows = row('File number (ours) / Invoice no.', d.ourFileNumber || d.fileReference) +
    row('UFN', d.ufn) + row('Firm', firmName) + row('LAA Account', d.firmLaaAccount) + row('MAAT ID', d.maatId);
  if (!adminRows) return '';
  return '<h2>11. Admin & Billing</h2><table>' + adminRows + '</table>';
})() +

(function() {
  var consentRows = row('Authority to act confirmed?', d.clientAuthorityConfirmed) +
    row('Method of authority', d.authorityMethod) + row('Date authority given', fmtDate(d.authorityDateGiven)) + row('Time authority given', d.authorityTimeGiven) +
    row('Authority confirmed by (name/role)', d.authorityConfirmedBy) + (d.authorityLimitations ? row('Limitations or conditions', d.authorityLimitations) : '') +
    row('Client capacity confirmed?', d.clientCapacityConfirmed) + row('Interpreter used for authority?', d.interpreterUsedForAuthority) +
    row('Retainer type', d.retainerType) + (d.retainerType === 'Legal Aid' ? row('Legal Aid application date', fmtDate(d.legalAidApplicationDate)) : '') + row('UFN / MAAT (when available)', d.retainerUfnMaat) +
    row('Client name', d.retainerClientName) + row('Date of birth', fmtDate(d.retainerDob)) + row('Client address', d.retainerAddress) +
    row('Appointed solicitor / firm', d.retainerSolicitorName) + row('Solicitor address', d.retainerSolicitorAddress) +
    row('Date', fmtDate(d.retainerDate)) + row('Retainer signed?', d.retainerSigned) + row('Copy on file?', d.retainerCopyOnFile);
  if (!consentRows) return '';
  return '<h2>12. Consents & Retainer</h2>' +
    '<p style="font-size:10px;margin-bottom:8px;"><em>I consent to the appointed firm acting for me in this matter; to communicate with the police, court, and other parties as necessary on my behalf; to instruct experts and obtain evidence where needed; and to accept and comply with Legal Aid funding (where applicable). I confirm that the information I have provided is accurate and that I have read and understood the terms of the retainer.</em></p>' +
    '<table>' + consentRows + '</table>';
})() +

(function() {
  var hasCrm14 = d.crm14SignedFormOnFile || d.crm14NewOrChange || d.crm14Title || d.crm14CaseType || d.crm14HasPartner || d.crm14PassportingBenefits || d.crm14InterestsOfJustice || d.crm14CourtName || d.crm14Urn;
  if (!hasCrm14) return '';
  var subSect = function(title, rows) { return rows ? '<p style="font-size:10px;font-weight:600;margin:12px 0 4px;">' + h(title) + '</p><table>' + rows + '</table>' : ''; };
  return '<h2>13. Legal Aid application (Apply for criminal legal aid / CRM14)</h2>' +
    '<p style="font-size:9px;color:#64748b;margin-bottom:8px;">Data required for the Apply for criminal legal aid service (mandatory) or paper CRM14 (limited circumstances). The signed online form (client-signed, typically 2 pages) must be retained on file.</p>' +
    row('Signed Apply application (client-signed, 2-page) on file?', d.crm14SignedFormOnFile) +
    subSect('About you – Personal details',
      row('New application or change of circumstances?', d.crm14NewOrChange) +
      row('Title', d.crm14Title) + row('First name(s)', d.crm14Forename || d.forename) + row('Surname', d.crm14Surname || d.surname) +
      row('Date of birth', fmtDate(d.crm14Dob || d.dob)) + row('National Insurance number', d.crm14NiNumber || d.niNumber) + row('ARC number', d.crm14ArcNumber || d.arcNumber)) +
    subSect('About you – Contact information',
      row('Usual home address', d.crm14HomeAddress || [d.address1, d.address2, d.address3, d.city, d.county, d.postCode].filter(Boolean).join(', ')) +
      row('Correspondence address (if different)', d.crm14CorrespondenceAddress) +
      row('Email address', d.crm14Email || d.clientEmail) + row('Landline', d.crm14Landline) + row('Mobile', d.crm14Mobile) + row('Work telephone', d.crm14WorkPhone)) +
    subSect('About you – Case details',
      row('Case type', d.crm14CaseType) + row('Court name', d.crm14CourtName) + row('Court hearing date', fmtDate(d.crm14CourtHearingDate)) +
      row('MAAT reference number', d.crm14MaatRef || d.maatId) + row('URN', d.crm14Urn) + row('UFN', d.ufn) + row('Appeal lodged date', fmtDate(d.crm14AppealLodgedDate))) +
    subSect('Housing and personal circumstances',
      row('Housing status', d.crm14HousingType || d.accommodationStatus) + row('Applicant under 18?', d.crm14Under18)) +
    subSect('Partner details',
      row('Do you have a partner?', d.crm14HasPartner) +
      row("Partner's full name", d.crm14PartnerName) + row("Partner's date of birth", fmtDate(d.crm14PartnerDob)) + row('Relationship to partner', d.crm14PartnerRelationship) +
      row("Partner's address (if different)", d.crm14PartnerAddress) + row('Partner is victim / witness / co-defendant?', d.crm14PartnerVictimWitnessCoDef)) +
    subSect('Financial assessment',
      row('Passporting benefits (ESA, JSA, Pension Credit, UC)?', d.crm14PassportingBenefits) +
      row('Household income over £12,475 per year?', d.crm14IncomeOverThreshold) + row('Income sources', d.crm14IncomeSources) +
      row('CRM15 financial statement required?', d.crm14Crm15Required) +
      row('Gross annual income', d.grossIncome) + row('Partner income', d.partnerIncome)) +
    subSect('Interests of Justice',
      d.crm14InterestsOfJustice ? row('Interests of Justice test – outcome and notes', d.crm14InterestsOfJustice) : '');
})() +

PDF_CASENOTE_ADVERT +
(function() {
    try {
      var payload = JSON.stringify(d);
      var encoded = typeof btoa !== 'undefined' ? btoa(unescape(encodeURIComponent(payload))) : '';
      if (encoded) return '<div style="font-size:1px;line-height:0;height:0;overflow:hidden;position:absolute;left:-9999px;color:transparent;">CUSTODY_NOTE_IMPORT:' + encoded + '</div>';
    } catch (e) { return ''; }
  })() +
'</body></html>';
  }

  /* ─── EXPORT / EMAIL ─── */
  function sendReportToFirm() {
    collectCurrentData();
    const d = formData;
    const clientName = [d.forename, d.surname].filter(Boolean).join(' ') || 'Unknown Client';
    const firmEmail = d.firmContactEmail || '';
    const firmName = d.firmName || 'Firm';
    if (!firmEmail) {
      showToast('No email address found for the instructing firm — add it on the Firms page', 'error');
      return;
    }
    const lines = [
      'ATTENDANCE REPORT',
      '=================',
      '',
      'Client: ' + clientName,
      'Station: ' + (d.policeStationName || 'N/A'),
      'Date: ' + (d.date || 'N/A'),
      'DSCC: ' + (d.dsccRef || 'N/A'),
      'Offence: ' + (d.offenceSummary || d.offence1Details || 'N/A'),
      'Custody No: ' + (d.custodyNumber || 'N/A'),
      'File number / Invoice no.: ' + (d.ourFileNumber || d.fileReference || 'N/A'),
      'UFN: ' + (d.ufn || 'N/A'),
      '',
      'TIMES',
      '-----',
      'Instruction received: ' + (formatInstructionDateTime(d.instructionDateTime) || 'N/A'),
      'Set off: ' + (d.timeSetOff || 'N/A'),
      'Arrived: ' + (d.timeArrival || 'N/A'),
      'Departed: ' + (d.timeDeparture || 'N/A'),
      '',
      'OUTCOME',
      '-------',
      'Decision: ' + (d.outcomeDecision || 'N/A'),
      'Further attendance: ' + (d.furtherAttendance || 'N/A'),
      '',
      'KEY NOTES',
      '---------',
      d.adviceGivenNotes || d.attendingOthersNotes || 'None recorded.',
      '',
      '---',
      'Sent from Custody Note | © Defence Legal Services Ltd',
    ];
    const subject = 'Attendance Report: ' + clientName + ' (' + (d.date || '') + ')';
    const body = encodeURIComponent(lines.join('\n'));
    const mailto = 'mailto:' + encodeURIComponent(firmEmail) + '?subject=' + encodeURIComponent(subject) + '&body=' + body;
    if (window.api && window.api.openExternal) {
      window.api.openExternal(mailto);
    } else {
      window.open(mailto, '_blank');
    }
  }

  /* ─── TELEPHONE ADVICE PDF (INVB) ─── */
  function buildTelephonePdfHtml(d, settings) {
    var h = function(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var row = function(l, v) { return v ? '<tr><td class="l">' + h(l) + '</td><td>' + h(String(v)) + '</td></tr>' : ''; };
    var sig = function(k) { return d[k] ? '<img src="' + d[k] + '" class="sig-img" alt="">' : '<em class="sig-unsigned">(not signed)</em>'; };
    var sn = d.policeStationName || d.policeStationId || '';
    var firmName = d.firmName || d.firmId || '';
    var brand = (settings.brandName || 'Defence Legal Services Ltd') + (settings.tradingAs ? ' t/a ' + settings.tradingAs : '');

    var clientNameForTitle = [d.forename, d.surname].filter(Boolean).join(' ') || '—';
    var myRefForTitle = d.fileReference || '—';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + h(clientNameForTitle) + ' | ' + h(myRefForTitle) + '</title>' +
      '<style>' +
      '@page{margin:15mm;size:A4;}' +
      'body{font-family:\'Segoe UI\',\'Helvetica Neue\',Arial,sans-serif;font-size:11px;padding:20px 24px 48px;color:#111;line-height:1.45;}' +
      'h1{font-size:18px;font-weight:700;color:#0f766e;margin:0 0 8px;letter-spacing:-0.02em;}' +
      'h2{font-size:12px;font-weight:700;margin:24px 0 8px;padding:8px 10px;background:#f0fdfa;color:#0f766e;border-radius:4px;border-left:4px solid #0f766e;border-top:1px solid #e2e8f0;padding-top:16px;print-color-adjust:exact;}' +
      'table{width:100%;border-collapse:collapse;margin-bottom:8px;}td{padding:6px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;}' +
      'tr:nth-child(even) td{background:#f8fafc;print-color-adjust:exact;}' +
      '.l{color:#475569;width:40%;font-weight:500;word-break:break-word;}' +
      '.nar{white-space:pre-wrap;font-size:10px;background:#f8fafc;padding:8px 10px 8px 13px;border-radius:4px;margin:6px 0;border:1px solid #e2e8f0;border-left:3px solid #0f766e;line-height:1.55;}' +
      '.letterhead{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:12px;padding:8px 0 10px;border-bottom:1px solid #e2e8f0;margin:0 0 10px;}' +
      '.lh-left{font-size:10px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.lh-center{font-size:11px;font-weight:800;letter-spacing:0.08em;color:#0f766e;text-transform:uppercase;}' +
      '.lh-right{font-size:9px;color:#475569;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.decl-box{font-size:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 12px;margin:10px 0;white-space:pre-wrap;print-color-adjust:exact;}' +
      '.sig-block{margin:10px 0;}.sig-block .sig-label{font-size:10px;font-weight:600;margin-bottom:4px;color:#334155;}' +
      '.sig-img{max-width:320px;max-height:90px;display:block;}.sig-unsigned{font-style:italic;color:#64748b;}' +
      '.invb-badge{display:inline-block;background:#0f766e;color:white;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:700;margin-left:8px;}' +
      '.cover-block{background:#f0fdf9;border:1px solid #99f6e4;border-radius:8px;padding:12px 16px;margin:10px 0 16px;display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;print-color-adjust:exact;}' +
      '.cover-item{font-size:10px;line-height:1.4;}.cover-item strong{color:#0f766e;}' +
      '.watermark{position:fixed;top:30%;left:5%;font-size:110px;font-weight:900;color:rgba(0,0,0,0.04);transform:rotate(-30deg);pointer-events:none;z-index:0;letter-spacing:12px;print-color-adjust:exact;}' +
      '@media print{.nar,.decl-box,.cover-block{page-break-inside:avoid;}h2{print-color-adjust:exact;}.watermark{print-color-adjust:exact;}}' +
      '</style></head><body>' +
      '<div class="letterhead">' +
      '<div class="lh-left">' + h(brand) + '</div>' +
      '<div class="lh-center">Telephone Advice</div>' +
      '<div class="lh-right">Ref ' + h(d.ourFileNumber || d.fileReference || '\u2014') + (d.date ? (' \u00B7 ' + h(fmtDate(d.date))) : '') + '</div>' +
      '</div>' +
      '<h1>Police Station Telephone Advice Note <span class="invb-badge">INVB</span></h1>' +
      '<p style="font-size:10px;color:#64748b;">' + h(brand) + ' | Generated ' + new Date().toLocaleString('en-GB') + '</p>' +
      '<div class="cover-block">' +
      '<div class="cover-item"><strong>Client:</strong> ' + h([d.forename, d.surname].filter(Boolean).join(' ') || '\u2014') + '</div>' +
      '<div class="cover-item"><strong>Station:</strong> ' + h(sn || '\u2014') + '</div>' +
      '<div class="cover-item"><strong>Date:</strong> ' + h(fmtDate(d.date) || '\u2014') + '</div>' +
      '<div class="cover-item"><strong>File number (ours) / Invoice no.:</strong> ' + h(d.ourFileNumber || d.fileReference || '\u2014') + '</div>' +
      '<div class="cover-item"><strong>Offence:</strong> ' + h(d.offenceSummary || '\u2014') + '</div>' +
      '<div class="cover-item"><strong>DSCC:</strong> ' + h(d.dsccRef || '\u2014') + '</div>' +
      '</div>' +
      (d.feeEarnerCertification !== 'Finalised' ? '<div class="watermark">TELEPHONE ADVICE</div>' : '') +

      '<h2>1. Call Details</h2><table>' +
      row('File number (ours) / Invoice no.', d.ourFileNumber || d.fileReference) + row('Date', fmtDate(d.date)) +
      row('Instruction received', formatInstructionDateTime(d.instructionDateTime)) +
      row('Source of Referral', d.sourceOfReferral) +
      row('DSCC Number', d.dsccRef) +
      row('Police Station', sn) +
      row('Instructing Firm', firmName) +
      row('Fee Earner', d.feeEarnerName) +
      row('Duty Solicitor', d.dutySolicitor) +
      row('Not CDD Matter', d.notCddMatter) +
      (d.cddDeclinedReason ? row('CDD Reason', d.cddDeclinedReason) : '') +
      row('Matter Type', d.matterTypeCode) +
      row('Offence', d.offenceSummary) +
      row('Fee Code', d.feeCode) +
      '</table>' +

      '<h2>2. Client &amp; Advice</h2><table>' +
      row('Name', [d.forename, d.surname].filter(Boolean).join(' ')) +
      row('Date of birth', fmtDate(d.dob)) +
      row('Gender', d.gender) +
      row('Telephone', d.clientPhone) +
      row('First contact', d.timeFirstContactWithClient) +
      row('Within 45 mins?', d.firstContactWithin45Mins) +
      (d.firstContactOver45MinsReason ? row('Reason >45 mins', d.firstContactOver45MinsReason) : '') +
      row('Conflict check', d.conflictCheckResult) +
      (d.conflictCheckNotes ? row('Conflict notes', d.conflictCheckNotes) : '') +
      row("Client's Decision", d.clientDecision) +
      '</table>' +
      (d.telephoneAdviceSummary ? '<p style="font-weight:600;margin:4px 0 2px;">Advice Given:</p><div class="nar">' + h(d.telephoneAdviceSummary) + '</div>' : '') +

      '<h2>3. Outcome</h2><table>' +
      row('Outcome', d.outcomeDecision) +
      row('Outcome Code', d.outcomeCode) +
      row('Further attendance likely?', d.furtherAttendance) +
      row('Case concluded date', fmtDate(d.caseConcludedDate)) +
      '</table>' +

      '<h2>4. Sign Off</h2>' +
      '<table>' +
      row('Total call duration (mins)', d.telephoneCallDuration) +
      row('Number of calls', d.numberOfCalls) +
      row('Number of suspects', d.numberOfSuspects) +
      row('Previous advice?', d.previousAdvice) + (d.previousAdviceDetails ? row('Details', d.previousAdviceDetails) : '') +
      row('Client Name', d.laaClientFullName) +
      '</table>' +
      (d.clientSig ? '<div class="sig-block"><p class="sig-label">Client signature</p>' + sig('clientSig') + '</div>' : '') +
      (d.feeEarnerSig ? '<div class="sig-block"><p class="sig-label">Fee earner signature</p>' + sig('feeEarnerSig') + '</div>' : '') +
      '<table>' + row('Fee Earner', d.laaFeeEarnerFullName) + row('Certification', d.feeEarnerCertification) +
      row('UFN', d.ufn) + row('Firm LAA Account', d.firmLaaAccount) +
      row('Ethnic Origin', d.ethnicOriginCode) + row('Disability', d.disabilityCode) +
      '</table>' +
      '<div class="decl-box">' + h(refData.laaDeclarationText || '') + '</div>' +
      PDF_CASENOTE_ADVERT +
      (function() {
        try {
          var payload = JSON.stringify(d);
          var encoded = typeof btoa !== 'undefined' ? btoa(unescape(encodeURIComponent(payload))) : '';
          if (encoded) return '<div style="font-size:1px;line-height:0;height:0;overflow:hidden;position:absolute;left:-9999px;color:transparent;">CUSTODY_NOTE_IMPORT:' + encoded + '</div>';
        } catch (e) { return ''; }
      })() +
      '</body></html>';
  }

  function getActivePdfBuilder() {
    return (formData._formType === 'telephone') ? buildTelephonePdfHtml : buildPdfHtml;
  }

  function exportPdf() {
    const data = getFormData();
    window.api.getSettings().then(settings => {
      const builder = getActivePdfBuilder();
      const html = builder(data, settings);
      const label = data._formType === 'telephone' ? 'tel-advice' : 'attendance';
      const n = [data.surname, data.forename].filter(Boolean).join('_') || label;
      const fn = n + '-' + (data.ufn ? data.ufn.replace('/', '-') : '') + '-' + ((data.date || '').replace(/-/g, '') || Date.now()) + '.pdf';
      window.api.printToPdf({ html: html, filename: fn }).then(p => showToast('PDF saved: ' + p, 'success')).catch(e => showToast('PDF failed: ' + (e && e.message), 'error'));
    });
  }

  function printAttendanceNote() {
    const data = getFormData();
    window.api.getSettings().then(settings => {
      const builder = getActivePdfBuilder();
      const html = builder(data, settings);
      const label = data._formType === 'telephone' ? 'tel-advice' : 'attendance';
      const n = [data.surname, data.forename].filter(Boolean).join('_') || label;
      const fn = n + '-' + (data.ufn ? data.ufn.replace('/', '-') : '') + '-' + ((data.date || '').replace(/-/g, '') || Date.now()) + '.pdf';
      window.api.printToPdf({ html: html, filename: fn }).then(function(p) {
        if (window.api.openPath) window.api.openPath(p);
        showToast('PDF saved: ' + p, 'success');
      }).catch(function(e) {
        showToast('PDF failed: ' + (e && e.message), 'error');
      });
    });
  }

  /** Generate PDF and open in default viewer so user can review before printing/saving. */
  function previewPdf() {
    const data = getFormData();
    window.api.getSettings().then(settings => {
      const builder = getActivePdfBuilder();
      const html = builder(data, settings);
      const label = data._formType === 'telephone' ? 'tel-advice' : 'attendance';
      const n = [data.surname, data.forename].filter(Boolean).join('_') || label;
      const fn = n + '-' + (data.ufn ? data.ufn.replace('/', '-') : '') + '-' + ((data.date || '').replace(/-/g, '') || Date.now()) + '.pdf';
      window.api.printToPdf({ html: html, filename: fn }).then(function(p) {
        if (window.api.openPath) window.api.openPath(p);
        showToast('PDF opened for preview', 'success');
      }).catch(function(e) {
        showToast('PDF failed: ' + (e && e.message), 'error');
      });
    });
  }

  function emailPdf() {
    const data = getFormData();
    window.api.getSettings().then(settings => {
      const email = (settings.email || '').trim();
      if (!email) { showToast('Set your email in Settings first', 'error'); return; }
      const builder = getActivePdfBuilder();
      const html = builder(data, settings);
      const label = data._formType === 'telephone' ? 'tel-advice' : 'attendance';
      const n = [data.surname, data.forename].filter(Boolean).join('_') || label;
      const fn = n + '-' + (data.ufn ? data.ufn.replace('/', '-') : '') + '-' + ((data.date || '').replace(/-/g, '') || Date.now()) + '.pdf';
      window.api.printToPdf({ html: html, filename: fn }).then(p => {
        const subj = encodeURIComponent((data._formType === 'telephone' ? 'Tel Advice' : 'Attendance') + ' \u2013 ' + [data.forename, data.surname].filter(Boolean).join(' ') + ' \u2013 ' + (data.ufn || ''));
        window.api.openExternal('mailto:' + email + '?subject=' + subj + '&body=' + encodeURIComponent('PDF attached: ' + fn));
        showToast('PDF saved to Desktop \u2014 attach: ' + fn, 'success');
      }).catch(e => showToast('Failed: ' + (e && e.message), 'error'));
    });
  }

  function printAttendanceNoteWithData(data) {
    if (!data) return;
    window.api.getSettings().then(settings => {
      const builder = (data._formType === 'telephone') ? buildTelephonePdfHtml : buildPdfHtml;
      const html = builder(data, settings);
      printGeneratedDoc(html);
    }).catch(e => showToast('Print failed: ' + (e && e.message), 'error'));
  }

  /** Generate PDF from given attendance data and open in default viewer (for picker flow). */
  function previewPdfWithData(data) {
    if (!data) return;
    window.api.getSettings().then(settings => {
      const builder = (data._formType === 'telephone') ? buildTelephonePdfHtml : buildPdfHtml;
      const html = builder(data, settings);
      const label = data._formType === 'telephone' ? 'tel-advice' : 'attendance';
      const n = [data.surname, data.forename].filter(Boolean).join('_') || label;
      const fn = n + '-' + (data.ufn ? data.ufn.replace('/', '-') : '') + '-' + ((data.date || '').replace(/-/g, '') || Date.now()) + '.pdf';
      window.api.printToPdf({ html: html, filename: fn }).then(function(p) {
        if (window.api.openPath) window.api.openPath(p);
        showToast('PDF opened for preview', 'success');
      }).catch(function(e) {
        showToast('PDF failed: ' + (e && e.message), 'error');
      });
    }).catch(e => showToast('Preview failed: ' + (e && e.message), 'error'));
  }

  function emailToSolicitorWithData(data) {
    if (!data) return;
    const firmEmail = (data.firmContactEmail || '').trim();
    if (!firmEmail) {
      showToast('No email address for the instructing firm. Add contact email in the attendance or on the Firms page.', 'error');
      return;
    }
    window.api.getSettings().then(settings => {
      const builder = (data._formType === 'telephone') ? buildTelephonePdfHtml : buildPdfHtml;
      const html = builder(data, settings);
      const label = data._formType === 'telephone' ? 'tel-advice' : 'attendance';
      const n = [data.surname, data.forename].filter(Boolean).join('_') || label;
      const fn = n + '-' + (data.ufn ? data.ufn.replace('/', '-') : '') + '-' + ((data.date || '').replace(/-/g, '') || Date.now()) + '.pdf';
      window.api.printToPdf({ html: html, filename: fn }).then(p => {
        const subj = encodeURIComponent((data._formType === 'telephone' ? 'Tel Advice' : 'Attendance note') + ' \u2013 ' + [data.forename, data.surname].filter(Boolean).join(' ') + ' \u2013 ' + (data.ufn || ''));
        const body = encodeURIComponent('Please find the attendance note PDF attached.\n\nFilename: ' + fn + '\n\nSent from Custody Note.');
        window.api.openExternal('mailto:' + encodeURIComponent(firmEmail) + '?subject=' + subj + '&body=' + body);
        showToast('PDF saved to Desktop. Attach "' + fn + '" and send to ' + firmEmail, 'success');
      }).catch(e => showToast('Failed: ' + (e && e.message), 'error'));
    });
  }

  var _attendancePickerAction = null;

  function showAttendancePickerModal(action) {
    _attendancePickerAction = action;
    var modal = document.getElementById('attendance-picker-modal');
    var titleEl = document.getElementById('attendance-picker-title');
    var listEl = document.getElementById('attendance-picker-list');
    if (!modal || !listEl) return;
    titleEl.textContent = action === 'email' ? 'Email to instructing solicitor' : 'Print or preview attendance note';
    listEl.innerHTML = '<li class="home-recent-empty">Loading…</li>';
    modal.classList.remove('hidden');
    var listFn = window.api.attendanceListFull || window.api.attendanceList;
    var isPrint = action === 'print';
    listFn().then(function(rows) {
      if (!rows || !rows.length) {
        listEl.innerHTML = '<li class="home-recent-empty">No attendances found. Create one first.</li>';
        return;
      }
      var sorted = rows.slice().sort(function(a, b) { return (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''); });
      listEl.innerHTML = sorted.map(function(r) {
        var name = (r.client_name && String(r.client_name).trim()) || 'Draft (no name)';
        var station = r.station_name || '';
        var date = r.attendance_date || '';
        if (date) {
          var dm = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (dm) date = dm[3] + '/' + dm[2] + '/' + dm[1];
        }
        var meta = [station, date].filter(Boolean).join(' \u00B7 ');
        if (isPrint) {
          return '<li class="attendance-picker-item" data-id="' + r.id + '">' +
            '<span class="picker-item-name">' + esc(name) + '</span><span class="picker-item-meta">' + esc(meta) + '</span>' +
            '<div class="picker-item-actions"><button type="button" class="btn btn-small picker-preview-btn" data-id="' + r.id + '">Preview</button>' +
            '<button type="button" class="btn btn-small picker-print-btn" data-id="' + r.id + '">Print</button></div></li>';
        }
        return '<li class="attendance-picker-item" data-id="' + r.id + '"><span class="picker-item-name">' + esc(name) + '</span><span class="picker-item-meta">' + esc(meta) + '</span></li>';
      }).join('');
      listEl.querySelectorAll('.attendance-picker-item').forEach(function(li) {
        var id = parseInt(li.dataset.id, 10);
        if (isNaN(id)) return;
        function loadAndRun(fn) {
          modal.classList.add('hidden');
          window.api.attendanceGet(id).then(function(row) {
            if (!row || !row.data) { showToast('Could not load attendance', 'error'); return; }
            var data = safeJson(row.data);
            fn(data);
          }).catch(function(err) {
            showToast('Failed to load attendance: ' + (err && err.message), 'error');
          });
        }
        if (isPrint) {
          li.querySelector('.picker-preview-btn')?.addEventListener('click', function(e) { e.stopPropagation(); loadAndRun(previewPdfWithData); });
          li.querySelector('.picker-print-btn')?.addEventListener('click', function(e) { e.stopPropagation(); loadAndRun(function(d) { printAttendanceNoteWithData(d); showToast('Print dialog opened', 'success'); }); });
        } else {
          li.addEventListener('click', function() {
            loadAndRun(emailToSolicitorWithData);
          });
        }
      });
    }).catch(function(err) {
      listEl.innerHTML = '<li class="home-recent-empty">Failed to load list.</li>';
      showToast('Failed to load attendances', 'error');
    });
  }

  function closeAttendancePickerModal() {
    document.getElementById('attendance-picker-modal')?.classList.add('hidden');
    _attendancePickerAction = null;
  }

  /* ═══════════════════════════════════════════════
     STANDALONE: VIDEO CAPTURE / VIDEO ID PARADE
     (Attach existing attendance or create new draft)
     ═══════════════════════════════════════════════ */

  function showStandaloneAttachChooser(kindTitle) {
    return new Promise(function(resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'sections-index';
      overlay.innerHTML =
        '<div class="sections-index-content" style="max-width:420px;width:92%;">' +
          '<h3 style="margin-top:0;">' + esc(kindTitle) + '</h3>' +
          '<p class="attendance-picker-hint">Choose how you want to proceed.</p>' +
          '<button type="button" class="btn btn-secondary" id="vid-attach-existing" style="width:100%;margin-bottom:0.5rem;">Attach to an existing attendance</button>' +
          '<button type="button" class="btn" id="vid-new-draft" style="width:100%;margin-bottom:0.5rem;">New client (create new draft)</button>' +
          '<button type="button" class="btn btn-secondary" id="vid-cancel" style="width:100%;">Cancel</button>' +
        '</div>';
      document.body.appendChild(overlay);

      function cleanup(val) {
        try { overlay.remove(); } catch (_) {}
        resolve(val);
      }

      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) cleanup(null);
      });
      overlay.querySelector('#vid-attach-existing')?.addEventListener('click', function() { cleanup('existing'); });
      overlay.querySelector('#vid-new-draft')?.addEventListener('click', function() { cleanup('new'); });
      overlay.querySelector('#vid-cancel')?.addEventListener('click', function() { cleanup(null); });
    });
  }

  function pickAttendanceIdForStandalone(titleText) {
    return new Promise(function(resolve) {
      var modal = document.getElementById('attendance-picker-modal');
      var titleEl = document.getElementById('attendance-picker-title');
      var listEl = document.getElementById('attendance-picker-list');
      var cancelBtn = document.getElementById('attendance-picker-cancel');
      if (!modal || !listEl || !titleEl) { resolve(null); return; }

      titleEl.textContent = titleText || 'Select attendance';
      listEl.innerHTML = '<li class="home-recent-empty">Loading…</li>';
      modal.classList.remove('hidden');

      var done = false;
      function finish(val) {
        if (done) return;
        done = true;
        try { modal.classList.add('hidden'); } catch (_) {}
        resolve(val);
      }

      function onCancel(e) { if (e) e.preventDefault(); finish(null); }
      cancelBtn?.addEventListener('click', onCancel, { once: true });

      var listFn = window.api.attendanceListFull || window.api.attendanceList;
      listFn().then(function(rows) {
        if (!rows || !rows.length) {
          listEl.innerHTML = '<li class="home-recent-empty">No attendances found. Create one first.</li>';
          return;
        }
        var sorted = rows.slice().sort(function(a, b) { return (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''); });
        listEl.innerHTML = sorted.map(function(r) {
          var name = (r.client_name && String(r.client_name).trim()) || 'Draft (no name)';
          var station = r.station_name || '';
          var date = r.attendance_date || '';
          if (date) {
            var dm = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (dm) date = dm[3] + '/' + dm[2] + '/' + dm[1];
          }
          var meta = [station, date].filter(Boolean).join(' · ');
          return '<li class="attendance-picker-item" data-id="' + r.id + '"><span class="picker-item-name">' + esc(name) + '</span><span class="picker-item-meta">' + esc(meta) + '</span></li>';
        }).join('');
        listEl.querySelectorAll('.attendance-picker-item').forEach(function(li) {
          li.addEventListener('click', function() {
            var id = parseInt(li.dataset.id, 10);
            finish(isNaN(id) ? null : id);
          });
        });
      }).catch(function() {
        listEl.innerHTML = '<li class="home-recent-empty">Failed to load list.</li>';
        showToast('Failed to load attendances', 'error');
      });
    });
  }

  function openStandaloneSectionForAttendance(attendanceId, standaloneId, fallbackData) {
    currentStandaloneSectionId = standaloneId;
    currentAttendanceId = attendanceId;
    // Show form view immediately for responsiveness. If we already have draft data,
    // render it right away while we fetch the saved record (file number etc.).
    showView('new');
    if (fallbackData && typeof fallbackData === 'object') {
      formData = JSON.parse(JSON.stringify(fallbackData));
      activeFormSections = formSections;
      currentSectionIdx = 0;
      renderForm(formData);
    }
    window.api.attendanceGet(attendanceId).then(function(row) {
      currentRecordStatus = row ? row.status : null;
      currentRecordArchived = !!(row && row.archived_at);
      formData = row && row.data ? safeJson(row.data) : {};
      activeFormSections = formSections;
      currentSectionIdx = 0;
      renderForm(formData);
    }).catch(function(e) {
      showToast('Failed to load attendance: ' + (e && e.message), 'error');
    });
  }

  function createNewDraftAndOpenStandalone(standaloneId) {
    var now = new Date();
    var base = {
      _formType: 'attendance',
      workType: 'First Police Station Attendance',
      date: now.toISOString().slice(0, 10),
      _draftNonce: String(Date.now()),
      _createdViaStandalone: standaloneId
    };
    showToast('Creating new draft…', 'info');
    window.api.attendanceSave({ id: null, data: base, status: 'draft' }).then(function(id) {
      // attendance-save normally returns a number; handle unexpected shapes safely.
      if (id && typeof id === 'object' && id.error) {
        showToast(id.message || 'Could not create draft', 'error');
        return;
      }
      var newId = null;
      if (typeof id === 'number') newId = id;
      else if (typeof id === 'string') newId = parseInt(id, 10);
      else if (id && typeof id === 'object' && typeof id.id === 'number') newId = id.id;
      if (!newId || isNaN(newId)) {
        showToast('Could not create draft (no id returned)', 'error');
        return;
      }
      openStandaloneSectionForAttendance(newId, standaloneId, base);
    }).catch(function(e) {
      showToast('Failed to create draft: ' + (e && e.message), 'error');
    });
  }

  function openVideoStandaloneFromHome(standaloneId, title) {
    showStandaloneAttachChooser(title || 'Video section').then(function(choice) {
      if (!choice) return;
      if (choice === 'existing') {
        pickAttendanceIdForStandalone('Select attendance for ' + (title || 'video section')).then(function(id) {
          if (!id) return;
          openStandaloneSectionForAttendance(id, standaloneId);
        });
      } else if (choice === 'new') {
        createNewDraftAndOpenStandalone(standaloneId);
      }
    });
  }

  /* ═══════════════════════════════════════════════
     POLICE STATION DOCUMENT GENERATORS
     ═══════════════════════════════════════════════ */

  function printGeneratedDoc(html) {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { showToast('Please allow pop-ups for this app to print documents', 'error'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  }

  function docStyles() {
    return '<style>body{font-family:Arial,sans-serif;font-size:11pt;color:#111;margin:2cm}' +
      'h1{font-size:14pt;border-bottom:2px solid #1d4ed8;padding-bottom:4px;margin-bottom:16px}' +
      'h2{font-size:12pt;margin-top:20px;margin-bottom:6px}' +
      'table{width:100%;border-collapse:collapse;margin-bottom:12px}' +
      'td,th{border:1px solid #ccc;padding:5px 8px;font-size:10pt}th{background:#eff6ff;font-weight:bold}' +
      '.sig-box{border:1px solid #333;height:60px;margin-top:4px;margin-bottom:12px}' +
      '.footer{font-size:8pt;color:#555;margin-top:2cm;border-top:1px solid #ccc;padding-top:6px}' +
      '@media print{@page{margin:1.5cm}}</style>';
  }

  function generateConflictCert() {
    const d = getFormData();
    const client = [d.forename, d.middleName, d.surname].filter(Boolean).join(' ') || 'Client not yet named';
    const fee = d.feeEarnerName || d.laaFeeEarnerFullName || '';
    const date = d.date || new Date().toISOString().slice(0, 10);
    const result = d.conflictCheckResult || '(not yet recorded)';
    const notes = d.conflictCheckNotes || 'None';
    const offence = d.offenceSummary || d.offence1Details || '(not yet recorded)';
    const station = d.policeStationName || '(not yet recorded)';

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Conflict Check Certificate</title>' + docStyles() + '</head><body>' +
      '<h1>Conflict of Interest Check – Certificate</h1>' +
      '<table><tr><th>Field</th><th>Detail</th></tr>' +
      '<tr><td>Date of check</td><td>' + date + '</td></tr>' +
      '<tr><td>Fee earner</td><td>' + esc(fee) + '</td></tr>' +
      '<tr><td>Client</td><td>' + esc(client) + '</td></tr>' +
      '<tr><td>Offence</td><td>' + esc(offence) + '</td></tr>' +
      '<tr><td>Police station</td><td>' + esc(station) + '</td></tr>' +
      '<tr><td>Result</td><td><strong>' + esc(result) + '</strong></td></tr>' +
      '<tr><td>Notes</td><td>' + esc(notes) + '</td></tr>' +
      '</table>' +
      '<p>I confirm that a conflict of interest check was carried out prior to advising the above-named client and that no conflict exists (or, if positive, that the matter has been referred as noted above).</p>' +
      '<h2>Signature</h2>' +
      '<div class="sig-box"></div>' +
      '<p>Name: ' + esc(fee) + '&nbsp;&nbsp;&nbsp;&nbsp; Date: ____________</p>' +
      '<div class="footer">© Defence Legal Services Ltd &nbsp;|&nbsp; Generated: ' + new Date().toLocaleString('en-GB') + '</div>' +
      '</body></html>';
    printGeneratedDoc(html);
  }

  function generateClientInstructionsDoc() {
    const d = getFormData();
    const client = [d.forename, d.middleName, d.surname].filter(Boolean).join(' ') || 'Client not yet named';
    const fee = d.feeEarnerName || d.laaFeeEarnerFullName || '';
    const date = d.instructionsSignatureDate || d.date || new Date().toISOString().slice(0, 10);
    const time = d.instructionsSignatureTime || '';
    const instructions = d.clientInstructions || '(no instructions recorded)';
    const adviceRe = d.adviceReInterview || '';
    const decision = d.clientDecision || '';
    const offence = d.offenceSummary || d.offence1Details || '';
    const station = d.policeStationName || '';

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Client Instructions – Confirmation</title>' + docStyles() + '</head><body>' +
      '<h1>Confirmation of Client Instructions</h1>' +
      '<table><tr><th>Field</th><th>Detail</th></tr>' +
      '<tr><td>Date</td><td>' + esc(date) + '</td></tr>' +
      (time ? '<tr><td>Time</td><td>' + esc(time) + '</td></tr>' : '') +
      '<tr><td>Client</td><td>' + esc(client) + '</td></tr>' +
      '<tr><td>Offence</td><td>' + esc(offence) + '</td></tr>' +
      '<tr><td>Police station</td><td>' + esc(station) + '</td></tr>' +
      '</table>' +
      '<h2>Client\'s Instructions</h2>' +
      '<p style="white-space:pre-wrap;border:1px solid #ccc;padding:8px;min-height:80px">' + esc(instructions) + '</p>' +
      (adviceRe ? '<h2>Advice Re Interview</h2><p>' + esc(adviceRe) + '</p>' : '') +
      (decision ? '<p><strong>Client\'s decision:</strong> ' + esc(decision) + '</p>' : '') +
      '<h2>Rep Signature</h2>' +
      '<p><em>I confirm that the above accurately records the advice I gave and the instructions I received from the client.</em></p>' +
      '<div class="sig-box"></div>' +
      '<p>Name: ' + esc(fee) + '&nbsp;&nbsp;&nbsp;&nbsp; Date: ' + esc(date) + (time ? ' &nbsp;&nbsp; Time: ' + esc(time) : '') + '</p>' +
      '<h2>Client Signature</h2>' +
      '<p><em>I confirm that the above accurately records the advice I received and the instructions I gave to my representative.</em></p>' +
      '<div class="sig-box"></div>' +
      '<p>Name (BLOCK CAPITALS): ______________________________&nbsp;&nbsp;&nbsp;&nbsp; Date: ' + esc(date) + (time ? ' &nbsp;&nbsp; Time: ' + esc(time) : '') + '</p>' +
      '<div class="footer">© Defence Legal Services Ltd &nbsp;|&nbsp; Generated: ' + new Date().toLocaleString('en-GB') + '</div>' +
      '</body></html>';
    printGeneratedDoc(html);
  }

  function generatePreparedStatement() {
    const d = getFormData();
    const client = [d.forename, d.middleName, d.surname].filter(Boolean).join(' ') || 'Client not yet named';
    const fee = d.feeEarnerName || d.laaFeeEarnerFullName || '';
    const date = d.date || new Date().toISOString().slice(0, 10);
    const offence = d.offenceSummary || d.offence1Details || '';
    const custodyNo = d.custodyNumber || '';
    const station = d.policeStationName || '';
    const oicName = d.oicName || '';

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prepared Statement</title>' + docStyles() + '</head><body>' +
      '<h1>Prepared Statement</h1>' +
      '<table><tr><th>Field</th><th>Detail</th></tr>' +
      '<tr><td>Name</td><td>' + esc(client) + '</td></tr>' +
      '<tr><td>Date of birth</td><td>' + esc(d.dob || '') + '</td></tr>' +
      '<tr><td>Date</td><td>' + esc(date) + '</td></tr>' +
      '<tr><td>Custody No.</td><td>' + esc(custodyNo) + '</td></tr>' +
      '<tr><td>Police station</td><td>' + esc(station) + '</td></tr>' +
      (oicName ? '<tr><td>OIC</td><td>' + esc(oicName) + '</td></tr>' : '') +
      '<tr><td>Alleged offence(s)</td><td>' + esc(offence) + '</td></tr>' +
      '</table>' +
      '<h2>Statement</h2>' +
      '<p>I, <strong>' + esc(client) + '</strong>, wish to make the following statement in advance of my police interview:</p>' +
      '<p style="border:1px solid #ccc;padding:8px;min-height:200px">&nbsp;</p>' +
      '<p>I reserve the right to give a fuller account at a later stage. I decline to answer any further questions beyond what is set out above.</p>' +
      '<h2>Signature</h2>' +
      '<div class="sig-box"></div>' +
      '<p>Name (BLOCK CAPITALS): ' + esc(client.toUpperCase()) + '&nbsp;&nbsp;&nbsp;&nbsp; Date: ' + esc(date) + '</p>' +
      '<h2>Solicitor / Representative</h2>' +
      '<div class="sig-box"></div>' +
      '<p>Name: ' + esc(fee) + '&nbsp;&nbsp;&nbsp;&nbsp; Date: ' + esc(date) + '</p>' +
      '<div class="footer">© Defence Legal Services Ltd &nbsp;|&nbsp; Generated: ' + new Date().toLocaleString('en-GB') + '</div>' +
      '</body></html>';
    printGeneratedDoc(html);
  }

  /* ═══════════════════════════════════════════════
     KEYBOARD SHORTCUTS (#10)
     ═══════════════════════════════════════════════ */
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        window.api.backupNow().then(function(p) { showToast('Backup saved: ' + p, 'success'); }).catch(function(err) { showToast('Failed: ' + (err && err.message), 'error'); });
        return;
      }
      const formViewActive = document.getElementById('view-form')?.classList.contains('active');
      if (!formViewActive) return;

      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        quietSave();
      }
      if (e.ctrlKey && e.key === 'ArrowRight') {
        e.preventDefault();
        showSection(currentSectionIdx + 1);
      }
      if (e.ctrlKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        showSection(currentSectionIdx - 1);
      }
      if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        exportPdf();
      }
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        printAttendanceNote();
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        previewPdf();
      }
    });
  }

  /* ═══════════════════════════════════════════════
     FONT SIZE
     ═══════════════════════════════════════════════ */
  function applyFontSize(size) {
    document.documentElement.style.fontSize = size + 'px';
  }

  function initFontSize() {
    window.api.getSettings().then(s => {
      const sz = s.fontSize || '16';
      applyFontSize(sz);
      const slider = document.getElementById('setting-font-size');
      if (slider) slider.value = sz;
      const label = document.getElementById('font-size-val');
      if (label) label.textContent = sz + 'px';
    });
  }

  /* ═══════════════════════════════════════════════
     SCRATCHPAD
     ═══════════════════════════════════════════════ */
  function initScratchpad() {
    window.api.getSettings().then(s => {
      const ta = document.getElementById('scratchpad-text');
      if (ta && s.scratchpadText) ta.value = s.scratchpadText;
    });

    document.getElementById('scratchpad-toggle')?.addEventListener('click', () => {
      const sp = document.getElementById('scratchpad');
      if (sp) sp.classList.toggle('hidden');
    });
    document.getElementById('scratchpad-close')?.addEventListener('click', () => {
      const sp = document.getElementById('scratchpad');
      sp?.classList.add('hidden');
      sp?.classList.remove('fullscreen');
    });
    document.getElementById('scratchpad-fullscreen')?.addEventListener('click', () => {
      document.getElementById('scratchpad')?.classList.toggle('fullscreen');
    });
    document.getElementById('scratchpad-text')?.addEventListener('input', debounce((e) => {
      window.api.setSettings({ scratchpadText: e.target.value });
    }, 1000));
  }

  function debounce(fn, ms) {
    let timer;
    return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
  }

  /* ═══════════════════════════════════════════════
     ENTER KEY NAVIGATION
     ═══════════════════════════════════════════════ */
  function initEnterNavigation() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const el = e.target;
      if (el.tagName === 'TEXTAREA') return;
      if (el.tagName === 'BUTTON') return;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT') {
        e.preventDefault();
        const form = document.getElementById('attendance-form');
        if (!form) return;
        const focusable = Array.from(form.querySelectorAll('input:not([type="hidden"]):not([readonly]), select, textarea'));
        const activeSection = form.querySelector('.form-section.active');
        const visible = focusable.filter(f => activeSection && activeSection.contains(f) && f.offsetParent !== null);
        const idx = visible.indexOf(el);
        if (idx >= 0 && idx < visible.length - 1) {
          visible[idx + 1].focus();
        }
      }
    });
  }

  /* ═══════════════════════════════════════════════
     CSV EXPORT FOR BILLING
     ═══════════════════════════════════════════════ */
  function exportCsv() {
    window.api.attendanceList().then(rows => {
      if (!rows.length) { showToast('No attendances to export', 'warning'); return; }
      const headers = ['UFN','Date','Client Surname','Client Initial','Station','Police Station ID',
        'Scheme ID','Custody No','DSCC No','Duty Solicitor','Matter Type','Outcome Decision',
        'Total Mins','Travel Social','Travel Unsocial','Waiting Social',
        'Waiting Unsocial','Advice Social','Advice Unsocial','Miles','Disbursements','No Suspects','No Attendances',
        'Net Profit','Net Travel','Net Waiting','Escape Fee','Firm','LAA Account','Status'];
      const csvRows = [headers.join(',')];
      rows.forEach(r => {
        const d = safeJson(r.data);
        const calc = calculateProfitCostsFromData(d);
        const row = [
          csvSafe(d.ufn), csvSafe(d.date),
          csvSafe(d.surname), csvSafe((d.forename || '').charAt(0)),
          csvSafe(d.policeStationName), csvSafe(d.policeStationCode || ''),
          csvSafe(d.schemeId), csvSafe(d.custodyNumber),
          csvSafe(d.dsccRef), csvSafe(d.dutySolicitor),
          csvSafe(d.matterTypeCode), csvSafe(d.outcomeDecision),
          d.totalMinutes || 0, d.travelSocial || 0, d.travelUnsocial || 0,
          d.waitingSocial || 0, d.waitingUnsocial || 0,
          d.adviceSocial || 0, d.adviceUnsocial || 0,
          d.milesClaimable || 0, (d.disbursements || []).reduce(function(sum, dis) { return sum + (parseFloat(dis.amount) || 0); }, 0).toFixed(2), d.numSuspects || '', d.numAttendances || 1,
          calc.totalProfit.toFixed(2), calc.travel.toFixed(2), calc.waiting.toFixed(2),
          calc.isEscape ? 'Yes' : 'No',
          csvSafe(d.firmName), csvSafe(d.firmLaaAccount),
          r.status || 'draft',
        ];
        csvRows.push(row.join(','));
      });
      const csv = csvRows.join('\n');
      const fn = 'attendances-export-' + new Date().toISOString().slice(0, 10) + '.csv';
      window.api.saveCsv({ csv, filename: fn }).then(p => showToast('CSV saved: ' + p, 'success')).catch(e => showToast('Failed: ' + (e && e.message), 'error'));
    });
  }

  function csvSafe(val) {
    if (val == null) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function calculateProfitCostsFromData(d) {
    const r = LAA.national;
    const mins = (k) => parseInt(d[k]) || 0;
    const travelCost = (mins('travelSocial') / 60 * r.travel.social) + (mins('travelUnsocial') / 60 * r.travel.unsocial);
    const waitingCost = (mins('waitingSocial') / 60 * r.waiting.social) + (mins('waitingUnsocial') / 60 * r.waiting.unsocial);
    const adviceCost = (mins('adviceSocial') / 60 * r.attendance.social) + (mins('adviceUnsocial') / 60 * r.attendance.unsocial);
    const milesCost = (parseFloat(d.milesClaimable) || 0) * LAA.mileageRate;
    const totalWithMiles = travelCost + waitingCost + adviceCost + milesCost;
    return { isEscape: totalWithMiles > LAA.escapeThreshold, totalWithMiles };
  }

  /* ═══════════════════════════════════════════════
     INITIALISE
     ═══════════════════════════════════════════════ */
  function hideSplash() {
    var el = document.getElementById('splash');
    if (!el || !el.parentNode) return;
    el.classList.add('fade-out');
    setTimeout(function () { el.remove(); }, 600);
  }

  function init() {
    if (!window.api) {
      document.body.innerHTML = '<p style="padding:2rem;font-family:sans-serif;">Run in Electron: <code>npm start</code></p>';
      return;
    }

    document.addEventListener('licence-activated', function () {
      updateHomeLicenceCard();
      updateGearLicenceItem();
    });
    updateGearLicenceItem();

    // Auto-import notifications from main process (folder watcher).
    if (window.api.onAutoImportImported) {
      window.api.onAutoImportImported(function(p) {
        if (!p) return;
        showToast('Auto-imported: ' + (p.file || 'record'), 'success');
        // If user is looking at the list, refresh it.
        try { refreshList && refreshList(); } catch (_) {}
      });
    }
    if (window.api.onAutoImportError) {
      window.api.onAutoImportError(function(p) {
        if (!p) return;
        showToast('Auto-import failed: ' + (p.file || '') + ' ' + (p.error || ''), 'error');
      });
    }

    /* Cross-device sync event listeners */
    if (window.api.onRecordsUpdatedFromSync) {
      window.api.onRecordsUpdatedFromSync(function(info) {
        showToast('Synced ' + (info && info.count || '') + ' record' + ((info && info.count !== 1) ? 's' : '') + ' from another device', 'success');
        try { loadHomeRecent(); } catch (_) {}
        try { refreshList(); } catch (_) {}
      });
    }
    if (window.api.onSyncStatusChanged) {
      window.api.onSyncStatusChanged(function(data) {
        updateSyncStatusIndicator(data);
        refreshSyncCounts();
      });
    }

    /* Delegated click on #app for home cards, gear menu, back buttons, etc. */
    var appEl = document.getElementById('app');
    if (appEl) {
      appEl.addEventListener('click', function(e) {
        var t = e.target && (e.target.closest ? e.target.closest('button') : (e.target.tagName === 'BUTTON' ? e.target : null));

        /* Home recent item click (li, not button) */
        if (!t) {
          var li = e.target && (e.target.closest ? e.target.closest('.home-recent-item') : null);
          if (li && li.dataset.id) {
            e.preventDefault();
            openAttendance(parseInt(li.dataset.id, 10));
          }
          return;
        }

        /* Gear dropdown items */
        if (t.classList && t.classList.contains('gear-item') && t.dataset.action) {
          e.preventDefault();
          document.getElementById('gear-dropdown')?.classList.add('hidden');
          switch (t.dataset.action) {
            case 'enter-licence-key':
              if (window.showLicenceOverlay) window.showLicenceOverlay({ title: 'Enter your licence key', message: 'Paste the key from your email (trial or purchase at custodynote.com).' });
              break;
            case 'records': showView('list'); break;
            case 'laa-forms': showLaaFormsNav(); break;
            case 'firms': showView('firms'); break;
            case 'reports': showView('reports'); break;
            case 'settings': showView('settings'); break;
            case 'help': showView('help'); break;
          }
          return;
        }

        /* Home screen stand-alone options (Admin, Consents, etc.) */
        if (t.classList && (t.classList.contains('home-standalone-btn') || t.classList.contains('home-standalone-card')) && t.dataset.standaloneId) {
          e.preventDefault();
          document.getElementById('gear-dropdown')?.classList.add('hidden');
          currentStandaloneSectionId = t.dataset.standaloneId;
          formData = {};
          currentAttendanceId = null;
          currentSectionIdx = 0;
          activeFormSections = formSections;
          prefillDefaults();
          renderForm(formData);
          showView('new');
          return;
        }

        /* Home screen LAA form cards (CRM1, CRM2, CRM3, Applicant Declaration) */
        if (t.closest && t.closest('[data-laa-form]')) {
          var card = t.closest('[data-laa-form]');
          e.preventDefault();
          showLaaFormPicker(card.dataset.laaForm);
          return;
        }

        /* Home screen tools (Records, LAA Forms, Firms, etc.) */
        if (t.classList && t.classList.contains('home-tool-btn') && t.dataset.action) {
          e.preventDefault();
          document.getElementById('gear-dropdown')?.classList.add('hidden');
          switch (t.dataset.action) {
            case 'records': showView('list'); break;
            case 'laa-forms': showLaaFormsNav(); break;
            case 'firms': showView('firms'); break;
            case 'reports': showView('reports'); break;
            case 'shortcut-print-pdf': showAttendancePickerModal('print'); break;
            case 'shortcut-email-solicitor': showAttendancePickerModal('email'); break;
            case 'shortcut-backup-now':
              window.api.backupNow().then(function(p) { showToast('Backup saved: ' + p, 'success'); }).catch(function(e) { showToast('Failed: ' + (e && e.message), 'error'); });
              break;
            case 'settings': showView('settings'); break;
            case 'help': showView('help'); break;
          }
          return;
        }

        if (!t.id) return;
        switch (t.id) {
          case 'home-enter-licence-btn':
            e.preventDefault();
            showView('settings');
            // Wait for loadLicenceSettingsUI async call to resolve before focusing
            (window.api && window.api.licenceStatus ? window.api.licenceStatus() : Promise.resolve(null)).then(function(st) {
              var licCard = document.getElementById('licence-settings-card');
              if (licCard) licCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
              if (st && st.isTrial) {
                var inp = document.getElementById('trial-upgrade-key');
                if (inp) { inp.focus(); inp.select(); }
              } else {
                var inp2 = document.getElementById('setting-licence-key');
                if (inp2) { inp2.focus(); inp2.select(); }
              }
            });
            return;
          case 'home-card-attendance':
            e.preventDefault();
            currentStandaloneSectionId = null;
            formData = {}; currentAttendanceId = null; currentSectionIdx = 0;
            activeFormSections = formSections;
            formData.workType = 'First Police Station Attendance';
            formData._formType = 'attendance';
            prefillDefaults();
            renderForm(formData);
            showView('new');
            return;
          case 'home-card-video-capture':
            e.preventDefault();
            openVideoStandaloneFromHome('videoCaptureStandalone', 'Video Capture');
            return;
          case 'home-card-video-id':
            e.preventDefault();
            openVideoStandaloneFromHome('videoIdParadeStandalone', 'Video Identification Parade');
            return;
          case 'home-card-telephone':
            e.preventDefault();
            formData = {}; currentAttendanceId = null; currentSectionIdx = 0;
            activeFormSections = telFormSections;
            formData.workType = 'Police Station Telephone Attendance';
            formData._formType = 'telephone';
            prefillDefaults();
            renderForm(formData);
            showView('new');
            return;
          case 'home-card-quick':
            e.preventDefault();
            openQuickCapture();
            return;
          case 'home-view-all':
            e.preventDefault();
            showView('list');
            return;
          case 'list-back-home':
            e.preventDefault();
            showView('home');
            return;
          case 'gear-menu-btn':
            e.preventDefault();
            var dd = document.getElementById('gear-dropdown');
            if (dd) dd.classList.toggle('hidden');
            return;
          case 'qc-cancel': e.preventDefault(); showView('home'); return;
          case 'qc-save': e.preventDefault(); saveQuickCapture(false); return;
          case 'qc-expand': e.preventDefault(); saveQuickCapture(true); return;
          case 'firms-back-btn': case 'reports-back-btn': case 'settings-back-btn': case 'help-back-btn': e.preventDefault(); showView('home'); return;
          default: break;
        }
      }, true);
    }

    /* Close gear dropdown when clicking outside */
    document.addEventListener('click', function(e) {
      var dd = document.getElementById('gear-dropdown');
      if (dd && !dd.classList.contains('hidden')) {
        var gearWrap = e.target.closest('.gear-wrap');
        if (!gearWrap) dd.classList.add('hidden');
      }
    });

    /* Internet connectivity indicator – footer + home */
    var netStatusEl = document.getElementById('net-status-text');
    function setNetStatus(online) {
      if (netStatusEl) {
        netStatusEl.textContent = online ? 'Internet: Connected' : 'Internet: Not connected';
        netStatusEl.className = 'footer-status ' + (online ? 'online' : 'offline');
      }
      var homeNet = document.getElementById('home-net-status');
      if (homeNet) {
        homeNet.textContent = online ? 'Internet: Connected' : 'Internet: Not connected';
        homeNet.className = 'home-status-item ' + (online ? 'online' : 'offline');
      }
    }
    setNetStatus(navigator.onLine);
    window.addEventListener('online', function () { setNetStatus(true); });
    window.addEventListener('offline', function () { setNetStatus(false); });

    /* Header live clock */
    startHeaderClock();

    /* Global search bar: filter list by query; if single match by file number, open that note */
    var globalSearchEl = document.getElementById('global-search');
    if (globalSearchEl) {
      globalSearchEl.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var q = globalSearchEl.value.trim();
        var listSearch = document.getElementById('list-search');
        if (listSearch) listSearch.value = q;
        if (!q) { showView('list'); refreshList(); return; }
        window.api.attendanceListFull().then(function(rows) {
          var qLower = q.toLowerCase();
          var filtered = rows.filter(function(r) {
            var d = safeJson(r.data);
            var hay = [r.client_name, r.station_name, r.dscc_ref, r.attendance_date, r.status, d.forename, d.middleName, d.surname, d.custodyNumber, d.ufn, d.date, d.policeStationName, d.fileReference, d.dsccRef, d.ourFileNumber].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(qLower);
          });
          if (listStatusFilter === 'draft') filtered = filtered.filter(function(r) { return (r.status || 'draft') === 'draft'; });
          else if (listStatusFilter === 'finalised') filtered = filtered.filter(function(r) { return r.status === 'finalised'; });
          if (filtered.length === 1) {
            var fileNum = String((safeJson(filtered[0].data).ourFileNumber || '')).trim();
            var qNorm = q.replace(/^#/, '').trim();
            if (fileNum && fileNum === qNorm) {
              openAttendance(filtered[0].id);
              showView('new');
              return;
            }
          }
          showView('list');
          refreshList();
        });
      });
    }

    /* Auto backup status */
    var backupStatusEl = document.getElementById('backup-status-text');
    function updateBackupStatus() {
      if (!backupStatusEl) return;
      if (window.api && window.api.getSettings) {
        window.api.getSettings().then(function(s) {
          var folder = s && s.backupFolder;
          if (folder) {
            backupStatusEl.textContent = 'Auto backup: ON (every 2 mins)';
            backupStatusEl.className = 'footer-status online';
          } else {
            backupStatusEl.textContent = 'Auto backup: OFF \u2014 no folder set';
            backupStatusEl.className = 'footer-status offline';
          }
        });
      } else {
        backupStatusEl.textContent = 'Auto backup: checking\u2026';
      }
    }
    updateBackupStatus();
    setInterval(updateBackupStatus, 60000);
    /* App version and update date from package.json */
    if (window.api.getAppVersion) {
      window.api.getAppVersion().then(function(info) {
        var vEl = document.getElementById('app-version');
        var uEl = document.getElementById('app-updated');
        if (vEl && info.version) vEl.textContent = info.version;
        if (uEl && info.lastUpdated) uEl.textContent = info.lastUpdated;
        if (info.version) window.__appVersion = info.version;
      });
    }
    // Populate licence footer badge on startup (visible on every screen)
    if (window.api && window.api.licenceStatus) {
      window.api.licenceStatus().then(function(st) { updateLicenceFooterBadge(st); }).catch(function() {});
    }

    /* Load bank holidays from cache / server */
    if (window.api.getBankHolidays) {
      window.api.getBankHolidays().then(function(dates) {
        if (dates && dates.length) {
          UK_BANK_HOLIDAYS.length = 0;
          dates.forEach(function(d) { UK_BANK_HOLIDAYS.push(d); });
        }
      }).catch(function(){});
    }

    /* Splash: hide when data ready + min 1.5s elapsed, or immediately if first-launch */
    var splashDataReady = false;
    var splashMinReached = false;
    var splashMinMs = 1500;
    function tryHideSplash() {
      if (!document.getElementById('splash')) return;
      if (splashDataReady && splashMinReached) hideSplash();
    }
    setTimeout(function () {
      splashMinReached = true;
      tryHideSplash();
    }, splashMinMs);

    Promise.all([
      window.api.stationsList(),
      window.api.firmsList(),
      window.api.loadReferenceData(),
      loadMagistratesCourts(),
    ]).then(([s, f, rd]) => {
      stations = s;
      firms = f;
      refData = rd || {};
      loadRecentStations();
      splashDataReady = true;
      tryHideSplash();
    }).catch(function(err) {
      console.error('[init] Failed to load stations/firms/refData:', err);
      splashDataReady = true;
      tryHideSplash();
    });

    /* First-launch setup check: hide splash immediately so user can complete setup */
    window.api.getSettings().then(function(s) {
      window._appSettingsCache = s || {};
      if (!s.dsccPin || !s.feeEarnerNameDefault) {
        hideSplash();
        initFirstLaunchModal();
      }
    });

    initDarkMode();
    initFontSize();
    initKeyboardShortcuts();
    initScratchpad();
    initEnterNavigation();

    /* Nav buttons and list actions already attached above */

    /* Delegated click for form action buttons (they are created inside renderForm and may be recreated) */
    document.getElementById('attendance-form')?.addEventListener('click', function(e) {
      const btn = e.target && (e.target.closest ? e.target.closest('button') : (e.target.tagName === 'BUTTON' ? e.target : null));
      if (!btn || !btn.id || !btn.id.startsWith('form-')) return;
      switch (btn.id) {
        case 'form-finalise': validateBeforeFinalise(); break;
        case 'form-pdf': exportPdf(); break;
        case 'form-print': printAttendanceNote(); break;
        case 'form-email': emailPdf(); break;
        case 'form-email-solicitor': emailToSolicitorWithData(getFormData()); break;
        case 'form-report-firm': sendReportToFirm(); break;
        case 'form-audit-log': showAuditLog(currentAttendanceId); break;
        case 'form-supervisor-approve':
          if (!currentAttendanceId) { showToast('Save the record first before recording supervisor approval', 'error'); return; }
          var note = (document.querySelector('[data-field="supervisorComments"]')?.value || '').trim();
          var name = (document.querySelector('[data-field="supervisorName"]')?.value || '').trim();
          if (!name) { showToast('Enter the supervising solicitor/manager name first', 'error'); return; }
          showConfirm('Record supervisor approval by ' + name + '?\n\nThis will be logged to the audit trail.', 'Supervisor Approval').then(function(ok) {
            if (!ok) return;
            window.api.supervisorApprove({ id: currentAttendanceId, note: note }).then(function() {
              showToast('Supervisor approval recorded and logged', 'success');
            }).catch(function(err) {
              showToast('Failed to record approval: ' + (err && err.message || err), 'error');
            });
          });
          break;
        case 'form-finalise-bar': validateBeforeFinalise(); break;
        case 'form-archive-btn':
          if (!currentAttendanceId) return;
          window.api.attendanceArchive(currentAttendanceId).then(function() {
            showToast('Record archived', 'info');
            setListFilterAndShowList('archived');
          }).catch(function() { showToast('Failed to archive record', 'error'); });
          break;
        case 'form-unarchive-btn':
          if (!currentAttendanceId) return;
          window.api.attendanceUnarchive(currentAttendanceId).then(function() {
            currentRecordArchived = false;
            updateFormBarVisibility();
            showToast('Record restored from archive', 'info');
          }).catch(function() { showToast('Failed to unarchive record', 'error'); });
          break;
        default:
          break;
      }
    });

    /* Auto-save audit: track last-modified per section */
    function recordSectionModified(e) {
      if (!e.target.matches('input, select, textarea')) return;
      const section = e.target.closest('[data-sec-idx]');
      if (section != null && section.dataset.secIdx !== undefined) {
        const idx = parseInt(section.dataset.secIdx, 10);
        if (!isNaN(idx)) {
          formData._sectionLastModified = formData._sectionLastModified || {};
          formData._sectionLastModified[idx] = new Date().toISOString();
        }
      }
    }
    const formEl = document.getElementById('attendance-form');
    formEl?.addEventListener('input', recordSectionModified);
    formEl?.addEventListener('change', recordSectionModified);

    document.getElementById('standalone-back-btn')?.addEventListener('click', function() {
      currentStandaloneSectionId = null;
      renderForm(formData);
      setFormTitle(activeFormSections[currentSectionIdx].title);
      updateProgressBar();
    });
    document.getElementById('form-prev')?.addEventListener('click', () => showSection(currentSectionIdx - 1));
    document.getElementById('form-next')?.addEventListener('click', () => showSection(currentSectionIdx + 1));
    document.getElementById('form-save-exit')?.addEventListener('click', saveAndExit);
    document.getElementById('form-sections-btn')?.addEventListener('click', openSectionsIndex);
    document.getElementById('sections-index-btn')?.addEventListener('click', openSectionsIndex);
    document.getElementById('sections-index-close')?.addEventListener('click', closeSectionsIndex);
    document.getElementById('laa-forms-btn')?.addEventListener('click', showLaaFormsPopup);
    document.getElementById('kb-help-btn')?.addEventListener('click', () => { document.getElementById('kb-help-modal').classList.remove('hidden'); });
    document.getElementById('header-sections-idx')?.addEventListener('click', openSectionsIndex);
    document.getElementById('header-laa-forms')?.addEventListener('click', showLaaFormsPopup);
    document.getElementById('header-kb-help')?.addEventListener('click', () => { document.getElementById('kb-help-modal').classList.remove('hidden'); });

    (function initScrollAutoHide() {
      var form = document.getElementById('attendance-form');
      if (!form) return;
      var lastScrollTop = 0;
      var scrollThreshold = 40;
      form.addEventListener('scroll', function() {
        var st = form.scrollTop;
        if (st > lastScrollTop && st > scrollThreshold) {
          document.body.classList.add('chrome-collapsed');
        } else if (st < lastScrollTop) {
          document.body.classList.remove('chrome-collapsed');
        }
        lastScrollTop = Math.max(0, st);
      }, { passive: true });
    })();
    document.getElementById('kb-help-close')?.addEventListener('click', () => { document.getElementById('kb-help-modal').classList.add('hidden'); });
    document.getElementById('kb-help-modal')?.addEventListener('click', (e) => { if (e.target.id === 'kb-help-modal') document.getElementById('kb-help-modal').classList.add('hidden'); });
    document.getElementById('sections-index')?.addEventListener('click', e => { if (e.target.id === 'sections-index') closeSectionsIndex(); });
    document.getElementById('attendance-picker-cancel')?.addEventListener('click', closeAttendancePickerModal);
    document.getElementById('attendance-picker-modal')?.addEventListener('click', function(e) {
      if (e.target.id === 'attendance-picker-modal') closeAttendancePickerModal();
    });
    document.getElementById('backup-now-btn')?.addEventListener('click', () => {
      window.api.backupNow().then(p => showToast('Backup saved: ' + p, 'success')).catch(e => showToast('Failed: ' + (e && e.message), 'error'));
    });
    var homeBackupEl = document.getElementById('home-backup-status');
    if (homeBackupEl) {
      homeBackupEl.title = 'Click to create a backup now';
      homeBackupEl.style.cursor = 'pointer';
      homeBackupEl.addEventListener('click', function() {
        window.api.backupNow().then(function(p) {
          showToast('Backup saved: ' + p, 'success');
          if (typeof updateHomeStatus === 'function') updateHomeStatus();
        }).catch(function(e) { showToast('Failed: ' + (e && e.message), 'error'); });
      });
    }
    document.getElementById('btn-db-repair')?.addEventListener('click', async () => {
      if (!window.api || !window.api.dbRepair) { showToast('Database repair is not available', 'error'); return; }
      const btn = document.getElementById('btn-db-repair');
      const status = document.getElementById('db-repair-status');
      if (btn) btn.disabled = true;
      if (status) status.textContent = 'Repairing…';
      try {
        const res = await window.api.dbRepair();
        if (!res || res.ok === false) {
          showToast('Repair failed: ' + (res && res.error ? res.error : 'Unknown error'), 'error');
          if (status) status.textContent = '';
          return;
        }
        const msg = `Repaired. Backfilled ${res.backfilled || 0}. Removed ${((res.removedBurst || 0) + (res.removedByKey || 0))} duplicates.`;
        showToast(msg, 'success', 6000);
        if (status) status.textContent = msg + (res.backupPath ? ' Safety copy: ' + res.backupPath : '');
        refreshList();
      } catch (e) {
        showToast('Repair failed: ' + (e && e.message ? e.message : e), 'error');
        if (status) status.textContent = '';
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    function setupPasswordToggle(inputId, btnId) {
      const input = document.getElementById(inputId);
      const btn = document.getElementById(btnId);
      if (!input || !btn) return;
      btn.addEventListener('click', () => {
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.textContent = isPassword ? 'Hide' : 'Show';
        btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
      });
    }
    setupPasswordToggle('setting-recovery-pw', 'btn-toggle-recovery-pw');
    setupPasswordToggle('setting-recovery-pw-confirm', 'btn-toggle-recovery-pw-confirm');
    document.getElementById('btn-set-recovery-pw')?.addEventListener('click', () => {
      const pw = document.getElementById('setting-recovery-pw')?.value || '';
      const pwConfirm = document.getElementById('setting-recovery-pw-confirm')?.value || '';
      if (!pw) { showToast('Please enter a recovery password', 'error'); return; }
      if (pw.length < 6) { showToast('Recovery password must be at least 6 characters', 'error'); return; }
      if (pw !== pwConfirm) { showToast('Passwords do not match', 'error'); return; }
      window.api.setRecoveryPassword(pw).then(r => {
        if (r && r.success) {
          showToast('Recovery password set — keep it safe, you will need it on a new computer', 'success', 6000);
          document.getElementById('setting-recovery-pw').value = '';
          document.getElementById('setting-recovery-pw-confirm').value = '';
          const el = document.getElementById('recovery-status');
          if (el) { el.textContent = 'Recovery password is SET'; el.style.color = 'green'; }
        } else {
          showToast('Failed to set recovery password: ' + (r && r.error ? r.error : 'Unknown error'), 'error');
        }
      }).catch(err => {
        showToast('Error setting recovery password: ' + (err.message || err), 'error');
      });
    });
    /* btn-new-attendance, btn-quick-capture, qc-* already attached above */
    document.getElementById('qc-setoff-now')?.addEventListener('click', () => { document.getElementById('qc-setoff').value = pad2(new Date().getHours()) + ':' + pad2(new Date().getMinutes()); });
    document.getElementById('qc-arrived-now')?.addEventListener('click', () => { document.getElementById('qc-arrived').value = pad2(new Date().getHours()) + ':' + pad2(new Date().getMinutes()); });
    document.getElementById('qc-first-contact-now')?.addEventListener('click', () => { const el = document.getElementById('qc-first-contact'); if (el) el.value = pad2(new Date().getHours()) + ':' + pad2(new Date().getMinutes()); });
    /* firms-back-btn already attached above */
    document.getElementById('firms-action-add')?.addEventListener('click', showFirmsAddSection);
    document.getElementById('firms-action-use-existing')?.addEventListener('click', showFirmsUseExistingSection);
    document.getElementById('firms-search-input')?.addEventListener('input', () => {
      const q = document.getElementById('firms-search-input')?.value || '';
      renderFirmsSearchResults(filterFirmsBySearch(q));
    });
    document.getElementById('firms-search-input')?.addEventListener('focus', () => {
      const q = document.getElementById('firms-search-input')?.value || '';
      renderFirmsSearchResults(filterFirmsBySearch(q));
    });
    /* reports-back-btn already attached above */
    document.getElementById('firms-page-prev')?.addEventListener('click', () => { firmsPage--; renderFirmsPage(); });
    document.getElementById('firms-page-next')?.addEventListener('click', () => { firmsPage++; renderFirmsPage(); });
    document.getElementById('list-search')?.addEventListener('input', () => { listPage = 1; refreshList(); });
    document.getElementById('list-page-prev')?.addEventListener('click', () => { listPage--; refreshList(); });
    document.getElementById('list-page-next')?.addEventListener('click', () => { listPage++; refreshList(); });
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        listStatusFilter = btn.dataset.filter;
        listPage = 1;
        refreshList();
      });
    });
    document.getElementById('list-sort')?.addEventListener('change', (e) => { listSortMode = e.target.value; listPage = 1; refreshList(); });
    document.getElementById('list-density-toggle')?.addEventListener('click', () => {
      const ul = document.getElementById('attendance-list');
      if (ul) ul.classList.toggle('compact');
      const btn = document.getElementById('list-density-toggle');
      btn.textContent = ul.classList.contains('compact') ? 'Comfortable' : 'Compact';
    });
    document.getElementById('dark-mode-toggle')?.addEventListener('click', () => {
      const isDark = document.documentElement.classList.toggle('dark');
      const dm = document.getElementById('setting-dark-mode');
      if (dm) dm.checked = isDark;
      document.getElementById('dark-mode-toggle').textContent = isDark ? '\u2600' : '\u263E';
      if (window.api) window.api.setSettings({ darkMode: isDark ? 'true' : 'false' });
    });
    /* settings-back-btn already attached above */
    document.getElementById('setting-show-supervisor-review')?.addEventListener('change', (e) => {
      const val = e.target && e.target.checked ? 'true' : 'false';
      window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, { showSupervisorReview: val });
      if (window.api) window.api.setSettings({ showSupervisorReview: val }).then(showSettingsSavedToast);
    });
    document.getElementById('setting-backup-browse')?.addEventListener('click', () => {
      window.api.chooseFolder().then(p => {
        if (p) {
          const el = document.getElementById('setting-backup-folder');
          if (el) { el.value = p; window.api.setSettings({ backupFolder: p }).then(showSettingsSavedToast); }
        }
      });
    });
    document.getElementById('setting-offsite-backup-browse')?.addEventListener('click', () => {
      window.api.chooseFolder({ forOffsite: true }).then(p => {
        if (p) {
          const el = document.getElementById('setting-offsite-backup-folder');
          if (el) { el.value = p; window.api.setSettings({ offsiteBackupFolder: p }).then(showSettingsSavedToast); }
        }
      });
    });
    document.getElementById('settings-save-btn')?.addEventListener('click', function() {
      if (typeof saveSettings === 'function') saveSettings();
    });
    /* ─── Licence event handlers ─── */
    document.getElementById('btn-licence-email-key')?.addEventListener('click', function() {
      if (!window.api.licenceEmailKey) return;
      var btn = this;
      btn.disabled = true;
      window.api.licenceEmailKey().then(function(r) {
        btn.disabled = false;
        showToast(r.ok ? 'Licence key sent to your email' : (r.error || 'Failed'), r.ok ? 'info' : 'error');
      });
    });
    document.getElementById('btn-licence-deactivate-device')?.addEventListener('click', function() {
      if (!window.api.licenceDeactivateMachine) return;
      if (!confirm('Deactivate this device? You will need to enter your licence key again on the new device. This computer will need a new activation.')) return;
      var btn = this;
      btn.disabled = true;
      window.api.licenceDeactivateMachine().then(function(r) {
        if (r.ok) {
          showToast(r.message || 'Device deactivated', 'info');
          if (window.api.licenceDeactivate) window.api.licenceDeactivate();
          if (window.showLicenceOverlay) window.showLicenceOverlay({ title: 'Activate Custody Note', message: 'Enter your licence key to activate on this device.' });
          if (window.initLicenceUI) window.initLicenceUI();
          loadLicenceSettingsUI();
        } else {
          showToast(r.error || 'Failed', 'error');
        }
        btn.disabled = false;
      });
    });
    document.getElementById('btn-licence-change')?.addEventListener('click', function() {
      if (!window.api.licenceDeactivate) return;
      if (!confirm('Change licence? Your current licence will be removed. Enter a new key in the overlay.')) return;
      if (window.api.licenceDeactivateMachine) window.api.licenceDeactivateMachine().catch(function() {});
      window.api.licenceDeactivate();
      if (window.showLicenceOverlay) window.showLicenceOverlay({ title: 'Activate Custody Note', message: 'Enter your new licence key.' });
      if (window.initLicenceUI) window.initLicenceUI();
      loadLicenceSettingsUI();
    });
    document.getElementById('btn-licence-remove')?.addEventListener('click', function() {
      if (!window.api.licenceDeactivate) return;
      if (!confirm('Remove licence? You will need to enter a key again to use the app. Paid features will be locked until you activate again.')) return;
      if (window.api.licenceDeactivateMachine) window.api.licenceDeactivateMachine().catch(function() {});
      window.api.licenceDeactivate();
      if (window.showLicenceOverlay) window.showLicenceOverlay({ title: 'Activate Custody Note', message: 'Enter your licence key to activate.' });
      if (window.initLicenceUI) window.initLicenceUI();
      loadLicenceSettingsUI();
    });
    document.getElementById('btn-licence-validate')?.addEventListener('click', function() {
      var resultEl = document.getElementById('licence-validate-result');
      var btn = document.getElementById('btn-licence-validate');
      if (!window.api.licenceValidate || !resultEl) return;
      if (btn) btn.disabled = true;
      resultEl.style.display = '';
      resultEl.textContent = 'Validating…';
      resultEl.style.color = '';
      window.api.licenceValidate().then(function(r) {
        if (btn) btn.disabled = false;
        if (!r) { resultEl.textContent = 'Network error'; resultEl.style.color = '#dc2626'; return; }
        var status = r.status || {};
        if (r.valid === true) {
          resultEl.textContent = 'Valid — licence is active.';
          resultEl.style.color = '#059669';
        } else if (status.status === 'expired') {
          resultEl.textContent = 'Expired — ' + (status.message || 'Subscription has expired.');
          resultEl.style.color = '#dc2626';
        } else if (status.status === 'already_used') {
          resultEl.textContent = 'Already used — ' + (status.message || 'Licence is in use on 2 devices.');
          resultEl.style.color = '#dc2626';
        } else if (status.status === 'invalid' || status.status === 'revoked') {
          resultEl.textContent = 'Invalid — ' + (status.message || 'Licence key is not valid.');
          resultEl.style.color = '#dc2626';
        } else {
          resultEl.textContent = (status.message || r.message || 'Network error');
          resultEl.style.color = '#dc2626';
        }
        loadLicenceSettingsUI();
      }).catch(function(e) {
        if (btn) btn.disabled = false;
        resultEl.textContent = 'Network error — ' + (e && e.message ? e.message : 'Could not reach server');
        resultEl.style.color = '#dc2626';
      });
    });
    document.getElementById('btn-licence-activate-settings')?.addEventListener('click', function() {
      var keyInput = document.getElementById('setting-licence-key');
      var errEl = document.getElementById('licence-activate-error');
      var raw = keyInput ? keyInput.value : '';
      var key = (typeof raw === 'string' ? raw : '').replace(/\s/g, '').trim().toUpperCase();
      if (!key) {
        if (errEl) { errEl.textContent = 'Enter a licence key'; errEl.style.display = ''; }
        return;
      }
      if (!window.api.licenceActivate) return;
      var btn = this;
      btn.disabled = true;
      if (errEl) errEl.style.display = 'none';
      window.api.licenceActivate({ key: key }).then(function(result) {
        btn.disabled = false;
        if (result.success) {
          keyInput.value = '';
          loadLicenceSettingsUI();
          showToast('Licence activated', 'info');
        } else {
          if (errEl) { errEl.textContent = result.message || 'Activation failed'; errEl.style.display = ''; }
        }
      }).catch(function(e) {
        btn.disabled = false;
        if (errEl) { errEl.textContent = (e && e.message) || 'Network error'; errEl.style.display = ''; }
      });
    });

    // Trial upgrade inline form handler
    document.getElementById('btn-trial-upgrade-activate')?.addEventListener('click', function() {
      var keyInput = document.getElementById('trial-upgrade-key');
      var errEl = document.getElementById('trial-upgrade-error');
      var raw = keyInput ? keyInput.value : '';
      var key = (typeof raw === 'string' ? raw : '').replace(/[\s-]/g, '').trim().toUpperCase();
      if (!key) {
        if (errEl) { errEl.textContent = 'Please paste your licence key'; errEl.style.display = ''; }
        return;
      }
      if (!window.api.licenceActivate) return;
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Activating\u2026';
      if (errEl) errEl.style.display = 'none';
      window.api.licenceActivate({ key: key }).then(function(result) {
        btn.disabled = false;
        btn.textContent = 'Activate';
        if (result.success) {
          if (keyInput) keyInput.value = '';
          loadLicenceSettingsUI();
          updateHomeLicenceCard();
          showToast('Licence activated \u2014 cloud backup enabled', 'info');
          // Refresh cloud backup entitlement now
          if (window.api.cloudBackupCheckEntitlement) window.api.cloudBackupCheckEntitlement().catch(function(){});
        } else {
          if (errEl) { errEl.textContent = result.message || 'Activation failed \u2014 check the key and try again'; errEl.style.display = ''; }
        }
      }).catch(function(e) {
        btn.disabled = false;
        btn.textContent = 'Activate';
        if (errEl) { errEl.textContent = (e && e.message) || 'Network error \u2014 check your connection'; errEl.style.display = ''; }
      });
    });

    /* ─── Cloud backup event handlers ─── */
    document.getElementById('cloud-backup-footer-status')?.addEventListener('click', function() {
      var txt = (this.textContent || '').trim();
      if (txt === 'Local backup only' || txt.indexOf('Local') >= 0) {
        showView('settings');
        setTimeout(function() {
          document.getElementById('cloud-backup-section')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
    });
    document.getElementById('btn-cloud-backup-subscribe')?.addEventListener('click', function() {
      var btn = document.getElementById('btn-cloud-backup-subscribe');
      if (!window.api.cloudBackupCheckEntitlement) return;
      if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
      window.api.cloudBackupCheckEntitlement().then(function() {
        if (btn) { btn.disabled = false; btn.textContent = 'Verify now'; }
      }).catch(function() {
        if (btn) { btn.disabled = false; btn.textContent = 'Verify now'; }
      });
    });
    document.getElementById('home-cloud-backup-cta')?.addEventListener('click', function() {
      var cta = document.getElementById('home-cloud-backup-cta');
      if (!window.api.cloudBackupCheckEntitlement) return;
      if (cta) { cta.disabled = true; cta.textContent = 'Checking…'; }
      window.api.cloudBackupCheckEntitlement().then(function() {
        if (window.api.cloudBackupStatus) return window.api.cloudBackupStatus();
      }).then(function() {
        if (cta) { cta.disabled = false; cta.textContent = 'Verify now →'; }
      }).catch(function() {
        if (cta) { cta.disabled = false; cta.textContent = 'Verify now →'; }
      });
    });
    document.getElementById('home-cloud-backup-dismiss')?.addEventListener('click', function() {
      var el = document.getElementById('home-cloud-backup-warning');
      if (el) el.style.display = 'none';
      try { localStorage.setItem('cloud-backup-warning-dismissed', Date.now()); } catch (_) {}
    });
    document.getElementById('btn-cloud-backup-restore')?.addEventListener('click', function() {
      var panel = document.getElementById('cloud-restore-panel');
      if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
      if (panel && panel.style.display !== 'none' && window.api.cloudBackupList) {
        var sel = document.getElementById('cloud-restore-select');
        var status = document.getElementById('cloud-restore-status');
        if (sel) sel.innerHTML = '<option value="">Loading backups...</option>';
        if (status) status.textContent = '';
        window.api.cloudBackupList().then(function(resp) {
          if (!sel) return;
          sel.innerHTML = '';
          if (resp.error) { sel.innerHTML = '<option value="">Error: ' + resp.error + '</option>'; return; }
          if (!resp.backups || !resp.backups.length) { sel.innerHTML = '<option value="">No cloud backups found</option>'; return; }
          resp.backups.forEach(function(b) {
            var opt = document.createElement('option');
            opt.value = b.key;
            var sizeKB = Math.round(b.size / 1024);
            opt.textContent = b.key + ' (' + sizeKB + ' KB, ' + new Date(b.lastModified).toLocaleString('en-GB') + ')';
            sel.appendChild(opt);
          });
        });
      }
    });
    document.getElementById('btn-cloud-restore-confirm')?.addEventListener('click', function() {
      var sel = document.getElementById('cloud-restore-select');
      var status = document.getElementById('cloud-restore-status');
      var key = sel ? sel.value : '';
      if (!key) { if (status) status.textContent = 'Select a backup first'; return; }
      if (status) status.textContent = 'Restoring...';
      if (typeof showConfirm === 'function') {
        showConfirm('Restore from cloud backup? This will replace your current database. A safety copy will be saved first.').then(function(ok) {
          if (!ok) { if (status) status.textContent = 'Cancelled'; return; }
          window.api.cloudBackupRestore({ backupKey: key }).then(function(result) {
            if (result.ok) {
              if (status) status.textContent = 'Restored successfully. Reloading...';
              setTimeout(function() { location.reload(); }, 1500);
            } else {
              if (status) status.textContent = 'Error: ' + (result.error || 'Restore failed');
            }
          });
        });
      } else {
        window.api.cloudBackupRestore({ backupKey: key }).then(function(result) {
          if (result.ok) {
            if (status) status.textContent = 'Restored successfully. Reloading...';
            setTimeout(function() { location.reload(); }, 1500);
          } else {
            if (status) status.textContent = 'Error: ' + (result.error || 'Restore failed');
          }
        });
      }
    });
    // Auto-update status listener
    if (window.api.onAppUpdateStatus) {
      window.api.onAppUpdateStatus(function(data) {
        var wrap = document.getElementById('update-footer-wrap');
        var el = document.getElementById('update-footer-status');
        var banner = document.getElementById('home-update-banner');
        var bannerText = document.getElementById('home-update-banner-text');
        var restartBtn = document.getElementById('home-update-restart-btn');
        if (data.status === 'downloading') {
          if (wrap && el) { wrap.style.display = ''; el.textContent = 'Downloading update v' + data.version + '\u2026'; el.onclick = null; }
          if (banner) banner.style.display = '';
          if (bannerText) bannerText.textContent = 'A new version (v' + data.version + ') is downloading. You\'ll be notified when it\'s ready to install.';
          if (restartBtn) restartBtn.style.display = 'none';
        } else if (data.status === 'ready') {
          if (wrap && el) { wrap.style.display = ''; el.textContent = '\u2713 Update v' + data.version + ' ready \u2014 click to restart'; el.onclick = function() { window.api.appUpdateInstall(); }; }
          if (banner) banner.style.display = '';
          if (bannerText) bannerText.textContent = 'Update v' + data.version + ' is ready. Restart the app to install.';
          if (restartBtn) { restartBtn.style.display = ''; restartBtn.textContent = 'Restart to install'; restartBtn.onclick = function() { window.api.appUpdateInstall(); }; }
        } else if (data.status === 'up-to-date') {
          if (banner) banner.style.display = 'none';
          var statusEl = document.getElementById('check-updates-status');
          if (statusEl) statusEl.textContent = '\u2713 You\'re up to date';
        } else if (data.status === 'error') {
          if (banner) banner.style.display = 'none';
        }
        // Also update the home-screen update button
        var homeBtn = document.getElementById('home-check-update-btn');
        if (homeBtn) {
          if (data.status === 'ready') {
            homeBtn.textContent = '\u21BB Install v' + data.version;
            homeBtn.style.color = '#059669';
            homeBtn.style.borderColor = '#059669';
            homeBtn.onclick = function() { window.api.appUpdateInstall(); };
          } else if (data.status === 'downloading') {
            homeBtn.textContent = '\u21BB Downloading v' + data.version + '\u2026';
            homeBtn.style.color = '#d97706';
            homeBtn.disabled = true;
          }
        }
      });
    }
    document.getElementById('check-updates-btn')?.addEventListener('click', function() {
      var btn = document.getElementById('check-updates-btn');
      var statusEl = document.getElementById('check-updates-status');
      if (!window.api.appCheckUpdates) return;
      if (btn) btn.disabled = true;
      if (statusEl) statusEl.textContent = 'Checking\u2026';
      window.api.appCheckUpdates().then(function(res) {
        if (statusEl) {
          if (res.status === 'up-to-date') statusEl.textContent = '\u2713 You\'re up to date';
          else if (res.status === 'available') statusEl.textContent = 'Update v' + (res.version || '') + ' found \u2014 downloading\u2026';
          else if (res.status === 'dev') statusEl.textContent = 'Updates only apply to the installed app.';
          else statusEl.textContent = 'Could not check: ' + (res.message || 'Unknown error');
        }
        if (res.status === 'up-to-date') showToast('You\'re up to date', 'success');
      }).catch(function() {
        if (statusEl) statusEl.textContent = 'Update check failed.';
      }).finally(function() {
        if (btn) btn.disabled = false;
      });
    });

    // Cloud backup status listener
    if (window.api.onCloudBackupStatusChanged) {
      window.api.onCloudBackupStatusChanged(function(data) {
        var footerEl = document.getElementById('cloud-backup-footer-status');
        var homeWarning = document.getElementById('home-cloud-backup-warning');
        if (data && data.enabled) {
          if (footerEl) { footerEl.textContent = 'Backing up to AWS'; footerEl.style.color = '#10b981'; footerEl.style.cursor = ''; footerEl.style.textDecoration = ''; }
          if (homeWarning) homeWarning.style.display = 'none';
          var checking = document.getElementById('cloud-backup-checking');
          var notSub = document.getElementById('cloud-backup-not-subscribed');
          var isSub = document.getElementById('cloud-backup-subscribed');
          var lastEl = document.getElementById('cloud-backup-last-success');
          var errEl = document.getElementById('cloud-backup-error');
          var supportEl = document.getElementById('cloud-backup-error-support');
          if (checking) checking.style.display = 'none';
          if (notSub) notSub.style.display = 'none';
          if (isSub) isSub.style.display = '';
          if (lastEl && data.lastSuccess) lastEl.textContent = 'Last successful upload: ' + new Date(data.lastSuccess).toLocaleString('en-GB');
          if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
          if (supportEl) supportEl.style.display = 'none';
        } else {
          if (footerEl) { footerEl.textContent = 'Local backup only'; footerEl.style.color = '#d97706'; footerEl.style.cursor = 'pointer'; footerEl.style.textDecoration = 'underline'; }
          var checking = document.getElementById('cloud-backup-checking');
          var notSub = document.getElementById('cloud-backup-not-subscribed');
          var isSub = document.getElementById('cloud-backup-subscribed');
          var errEl = document.getElementById('cloud-backup-error');
          var supportEl = document.getElementById('cloud-backup-error-support');
          if (checking) checking.style.display = 'none';
          if (notSub) notSub.style.display = '';
          if (isSub) isSub.style.display = 'none';
          // Update the reason text based on licence status
          var reasonEl = document.getElementById('cloud-backup-unavailable-reason');
          if (reasonEl) {
            if (data && data.isTrial) {
              reasonEl.innerHTML = 'You are on a <strong>trial licence</strong>. Cloud backup is included with paid subscriptions only. <a href="https://custodynote.com/buy" target="_blank" rel="noopener" style="color:#1e40af;">Subscribe at custodynote.com/buy</a> to enable it.';
            } else if (data && data.lastError) {
              reasonEl.textContent = 'Cloud backup verification failed: ' + data.lastError + '. Check your internet connection and try again.';
            } else {
              reasonEl.innerHTML = 'Cloud backup is included with paid subscriptions. <a href="https://custodynote.com/buy" target="_blank" rel="noopener" style="color:#1e40af;">Subscribe at custodynote.com/buy</a> then enter your licence key in Settings \u203a Licence.';
            }
          }
          if (data && data.lastError && errEl) {
            errEl.textContent = data.lastError;
            errEl.style.display = '';
            if (supportEl) supportEl.style.display = '';
          }
        }
      });
    }
    // Show home cloud backup warning on startup
    if (window.api.cloudBackupStatus) {
      window.api.cloudBackupStatus().then(function(status) {
        var footerEl = document.getElementById('cloud-backup-footer-status');
        var homeWarning = document.getElementById('home-cloud-backup-warning');
        if (status && status.enabled) {
          if (footerEl) { footerEl.textContent = 'Backing up to AWS'; footerEl.style.color = '#10b981'; footerEl.style.cursor = ''; footerEl.style.textDecoration = ''; }
          if (homeWarning) homeWarning.style.display = 'none';
        } else {
          if (footerEl) { footerEl.textContent = 'Local backup only'; footerEl.style.color = '#d97706'; footerEl.style.cursor = 'pointer'; footerEl.style.textDecoration = 'underline'; }
          // Show warning unless recently dismissed (within 7 days)
          try {
            var dismissed = localStorage.getItem('cloud-backup-warning-dismissed');
            var showWarning = !dismissed || (Date.now() - parseInt(dismissed, 10)) > 7 * 24 * 60 * 60 * 1000;
            if (homeWarning && showWarning) homeWarning.style.display = '';
          } catch (_) {
            if (homeWarning) homeWarning.style.display = '';
          }
        }
      });
    }

    // ── System Status Diagnostic Panel ──────────────────────────────────────
    (function initSystemStatus() {
      var _lastCloudStatus = null;
      var _lastUpdateStatus = null;

      // Track cloud backup status changes
      if (window.api.onCloudBackupStatusChanged) {
        window.api.onCloudBackupStatusChanged(function(data) {
          _lastCloudStatus = data;
          updateSysStatBackup(data);
        });
      }
      // Track auto-update status changes
      if (window.api.onAppUpdateStatus) {
        window.api.onAppUpdateStatus(function(data) {
          _lastUpdateStatus = data;
          updateSysStatUpdate(data);
        });
      }

      function setBlock(iconId, icon, iconColor, line1Id, line1, line2Id, line2) {
        var ic = document.getElementById(iconId);
        var l1 = document.getElementById(line1Id);
        var l2 = document.getElementById(line2Id);
        if (ic) { ic.textContent = icon; ic.style.color = iconColor || ''; }
        if (l1) l1.textContent = line1 || '';
        if (l2) l2.textContent = line2 || '';
      }

      function updateSysStatLicence(st) {
        if (!st) { setBlock('sysstat-licence-icon','⏳','','sysstat-licence-line1','Checking licence…','sysstat-licence-line2',''); return; }
        var icon, color, line1, line2, line3 = '';
        var l3El = document.getElementById('sysstat-licence-line3');
        if (st.status === 'active' && st.isTrial) {
          icon = '⚠️'; color = '#d97706';
          line1 = 'Trial licence active — ' + (st.daysRemaining != null ? st.daysRemaining + ' day' + (st.daysRemaining !== 1 ? 's' : '') + ' remaining' : 'expires ' + new Date(st.expiresAt).toLocaleDateString('en-GB'));
          line2 = 'Enter a paid licence key in Settings › Licence to activate cloud backup and remove this notice.';
          line3 = 'Get a licence at custodynote.com/buy';
        } else if (st.status === 'active') {
          icon = '✅'; color = '#059669';
          line1 = 'Licence active';
          line2 = st.expiresAt ? 'Expires: ' + new Date(st.expiresAt).toLocaleDateString('en-GB') : 'Subscription active — no expiry date returned';
          line3 = st.lastValidated ? 'Last validated: ' + new Date(st.lastValidated).toLocaleString('en-GB') : '';
        } else if (st.status === 'expiring_soon') {
          icon = '⚠️'; color = '#d97706';
          line1 = 'Expiring soon — ' + (st.daysRemaining || '') + ' days remaining';
          line2 = 'Renew at custodynote.com/buy';
          line3 = st.lastValidated ? 'Last validated: ' + new Date(st.lastValidated).toLocaleString('en-GB') : '';
        } else if (st.status === 'expired' || st.status === 'grace_expired') {
          icon = '❌'; color = '#dc2626';
          line1 = 'Licence expired';
          line2 = st.message || 'Renew your subscription at custodynote.com/buy';
          line3 = '';
        } else if (st.status === 'revoked') {
          icon = '❌'; color = '#dc2626';
          line1 = 'Licence revoked';
          line2 = 'Contact support at custodynote.com/support';
          line3 = '';
        } else {
          icon = '❓'; color = '#64748b';
          line1 = 'No licence found';
          line2 = 'Enter a licence key in Settings › Licence, or start a trial from the home screen.';
          line3 = '';
        }
        var ic = document.getElementById('sysstat-licence-icon');
        var l1 = document.getElementById('sysstat-licence-line1');
        var l2 = document.getElementById('sysstat-licence-line2');
        if (ic) { ic.textContent = icon; ic.style.color = color; }
        if (l1) l1.textContent = line1;
        if (l2) l2.textContent = line2;
        if (l3El) l3El.textContent = line3;
      }

      function updateSysStatBackup(data) {
        var l2El = document.getElementById('sysstat-backup-line2');
        if (!data) {
          setBlock('sysstat-backup-icon','⏳','','sysstat-backup-line1','Checking cloud backup…','sysstat-backup-line2','');
          return;
        }
        if (data.enabled) {
          setBlock('sysstat-backup-icon','✅','#059669','sysstat-backup-line1','Backing up to AWS (UK region)','sysstat-backup-line2','');
          if (l2El) l2El.textContent = data.lastSuccess ? 'Last upload: ' + new Date(data.lastSuccess).toLocaleString('en-GB') : 'Backup active — no uploads yet this session';
        } else if (data.isTrial) {
          setBlock('sysstat-backup-icon','ℹ️','#2563eb','sysstat-backup-line1','Local backup only — trial licence','sysstat-backup-line2','');
          if (l2El) l2El.textContent = 'Cloud backup is not included in the free trial. Subscribe at custodynote.com/buy to enable it.';
        } else {
          setBlock('sysstat-backup-icon','⚠️','#d97706','sysstat-backup-line1','Local backup only','sysstat-backup-line2','');
          var reason = data.lastError || 'Cloud backup requires a paid subscription. Subscribe at custodynote.com/buy.';
          if (l2El) l2El.textContent = reason;
        }
      }

      function updateSysStatUpdate(data) {
        var l2El = document.getElementById('sysstat-update-line2');
        var versionFromFooter = ((document.getElementById('app-version') && document.getElementById('app-version').textContent) || '').trim();
        var currentVersion = String(window.__appVersion || versionFromFooter || '').trim();
        if (!data) {
          setBlock('sysstat-update-icon','⏳','','sysstat-update-line1','Checking auto-update…','sysstat-update-line2','');
          return;
        }
        if (data.status === 'up-to-date') {
          setBlock('sysstat-update-icon','✅','#059669','sysstat-update-line1','Up to date' + (currentVersion ? ' — v' + currentVersion : ''),'sysstat-update-line2','');
          if (l2El) l2El.textContent = 'Auto-update enabled · Checks every 4 hours · Next check within ' + (4 - (new Date().getMinutes() / 60)).toFixed(1) + 'h';
        } else if (data.status === 'downloading') {
          setBlock('sysstat-update-icon','⬇️','#2563eb','sysstat-update-line1','Downloading update v' + data.version + '…','sysstat-update-line2','');
          if (l2El) l2El.textContent = 'Will install automatically on next restart';
        } else if (data.status === 'ready') {
          setBlock('sysstat-update-icon','🔄','#059669','sysstat-update-line1','Update v' + data.version + ' ready to install','sysstat-update-line2','');
          if (l2El) l2El.textContent = 'Restart the app to apply the update';
        } else if (data.status === 'dev') {
          setBlock('sysstat-update-icon','🔧','#64748b','sysstat-update-line1','Running in development mode','sysstat-update-line2','');
          if (l2El) l2El.textContent = 'Auto-updates apply to the installed (packaged) app only';
        } else if (data.status === 'error') {
          setBlock('sysstat-update-icon','⚠️','#d97706','sysstat-update-line1','Update check failed','sysstat-update-line2','');
          if (l2El) l2El.textContent = data.message || 'Could not reach update server — will retry automatically';
        } else {
          setBlock('sysstat-update-icon','⏳','','sysstat-update-line1','Waiting for update check…','sysstat-update-line2','');
          if (l2El) l2El.textContent = 'Auto-update checks every 4 hours when the app is running';
        }
      }

      function runDiagnostics() {
        // Licence
        if (window.api && window.api.licenceStatus) {
          window.api.licenceStatus().then(function(st) { updateSysStatLicence(st); }).catch(function() {
            setBlock('sysstat-licence-icon','❓','#64748b','sysstat-licence-line1','Could not read licence status','sysstat-licence-line2','');
          });
        }
        // Cloud backup
        if (window.api && window.api.cloudBackupStatus) {
          window.api.cloudBackupStatus().then(function(st) {
            if (!_lastCloudStatus) { _lastCloudStatus = st; updateSysStatBackup(st); }
          }).catch(function() {
            setBlock('sysstat-backup-icon','❓','#64748b','sysstat-backup-line1','Could not read backup status','sysstat-backup-line2','');
          });
        } else {
          updateSysStatBackup(_lastCloudStatus);
        }
        // Auto-update: trigger a check so the status IPC fires
        if (window.api && window.api.appCheckUpdates) {
          window.api.appCheckUpdates().then(function(res) {
            if (!_lastUpdateStatus) updateSysStatUpdate(res);
          }).catch(function() {
            updateSysStatUpdate({ status: 'error', message: 'Update check failed' });
          });
        } else {
          updateSysStatUpdate(_lastUpdateStatus || { status: 'dev' });
        }
      }

      // Run on view load
      document.addEventListener('view-settings-shown', function() { runDiagnostics(); });

      // Refresh button
      var refreshBtn = document.getElementById('sysstat-refresh-btn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
          refreshBtn.disabled = true;
          refreshBtn.textContent = 'Refreshing…';
          _lastCloudStatus = null;
          _lastUpdateStatus = null;
          // Reset to pending state
          ['sysstat-licence-icon','sysstat-backup-icon','sysstat-update-icon'].forEach(function(id) {
            var el = document.getElementById(id); if (el) { el.textContent = '⏳'; el.style.color = ''; }
          });
          ['sysstat-licence-line1','sysstat-backup-line1','sysstat-update-line1'].forEach(function(id) {
            var el = document.getElementById(id); if (el) el.textContent = 'Checking…';
          });
          ['sysstat-licence-line2','sysstat-backup-line2','sysstat-update-line2','sysstat-licence-line3'].forEach(function(id) {
            var el = document.getElementById(id); if (el) el.textContent = '';
          });
          if (window.api && window.api.cloudBackupCheckEntitlement) {
            window.api.cloudBackupCheckEntitlement().catch(function() {});
          }
          runDiagnostics();
          setTimeout(function() {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh diagnostics';
          }, 3000);
        });
      }

      // Initial run (delayed slightly to allow status events to arrive first)
      setTimeout(runDiagnostics, 800);
    })();
    // ── End System Status ────────────────────────────────────────────────────

    document.getElementById('settings-load-from-pdf')?.addEventListener('click', function() {
      if (!window.api || !window.api.importRecordFromFile) { showToast('Import not available', 'error'); return; }
      window.api.importRecordFromFile().then(function(result) {
        if (result.error) {
          if (result.error !== 'cancelled') showToast(result.error, 'error');
          return;
        }
        var data = result.data;
        if (!data || typeof data !== 'object') { showToast('No record data in file', 'error'); return; }
        delete data.id;
        delete data.created_at;
        delete data.updated_at;
        window.api.attendanceSave({ data: data, status: 'draft' }).then(function(id) {
          if (id && id.error) { showToast(id.message || id.error || 'Save failed', 'error'); return; }
          showView('home');
          openAttendance(id);
          showToast('Record imported and opened', 'success');
        }).catch(function(e) { showToast('Save failed: ' + (e && e.message), 'error'); });
      }).catch(function(e) { showToast('Import failed: ' + (e && e.message), 'error'); });
    });

    function importRecordFromResult(result) {
      if (!result) { showToast('Import failed: no result', 'error'); return; }
      if (result.error) {
        if (result.error !== 'cancelled') showToast(result.error, 'error');
        return;
      }
      var data = result.data;
      if (!data || typeof data !== 'object') { showToast('No record data in file', 'error'); return; }
      delete data.id;
      delete data.created_at;
      delete data.updated_at;
      window.api.attendanceSave({ data: data, status: 'draft' }).then(function(id) {
        if (id && id.error) { showToast(id.message || id.error || 'Save failed', 'error'); return; }
        showView('home');
        openAttendance(id);
        showToast('Record imported and opened', 'success');
      }).catch(function(e) { showToast('Save failed: ' + (e && e.message), 'error'); });
    }

    document.getElementById('settings-import-path-btn')?.addEventListener('click', function() {
      if (!window.api || !window.api.importRecordFromPath) { showToast('Import not available', 'error'); return; }
      var el = document.getElementById('settings-import-path');
      var p = el && el.value ? el.value.trim() : '';
      if (!p) { showToast('Paste a PDF/JSON path first', 'error'); return; }
      window.api.importRecordFromPath(p).then(importRecordFromResult).catch(function(e) {
        showToast('Import failed: ' + (e && e.message), 'error');
      });
    });

    // Drag & drop PDF/JSON anywhere to import
    ;(function setupDragDropImport() {
      if (!window.api || !window.api.importRecordFromPath) return;
      function isSupported(name) {
        var n = String(name || '').toLowerCase();
        return n.endsWith('.pdf') || n.endsWith('.json');
      }
      document.addEventListener('dragover', function(e) {
        if (!e.dataTransfer) return;
        e.preventDefault();
      });
      document.addEventListener('drop', function(e) {
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        var f = e.dataTransfer.files[0];
        if (!f || !f.path || !isSupported(f.name)) return;
        e.preventDefault();
        showToast('Importing ' + f.name + '…', 'info');
        window.api.importRecordFromPath(f.path).then(importRecordFromResult).catch(function(err) {
          showToast('Import failed: ' + (err && err.message), 'error');
        });
      });
    })();

    // Auto-import settings (folder watcher runs in main process)
    document.getElementById('setting-auto-import-enabled')?.addEventListener('change', function(e) {
      var val = e && e.target && e.target.checked ? 'true' : 'false';
      window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, { autoImportEnabled: val });
      if (window.api) window.api.setSettings({ autoImportEnabled: val }).then(showSettingsSavedToast);
    });
    document.getElementById('setting-auto-import-browse')?.addEventListener('click', function() {
      window.api.chooseFolder({ title: 'Choose auto-import folder' }).then(function(p) {
        if (p) {
          var el = document.getElementById('setting-auto-import-folder');
          if (el) el.value = p;
          window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, { autoImportFolder: p });
          if (window.api) window.api.setSettings({ autoImportFolder: p }).then(showSettingsSavedToast);
        }
      });
    });
    document.getElementById('add-firm-btn')?.addEventListener('click', addFirm);
    var firmPhoneInput = document.getElementById('new-firm-phone');
    if (firmPhoneInput) attachPhoneValidation(firmPhoneInput);
    var firmEmailInput = document.getElementById('new-firm-email');
    if (firmEmailInput) attachEmailValidation(firmEmailInput);
    document.getElementById('btn-import-qf-clients')?.addEventListener('click', importFirmsFromQuickFile);
    ['crm1', 'crm2', 'crm3', 'declaration'].forEach(function(ft) {
      var btn = document.getElementById('settings-laa-' + ft);
      if (btn) btn.addEventListener('click', function() {
        window.api.laaOpenOfficialTemplate(ft).then(function(r) {
          if (r && r.error) showToast(r.error, 'error');
          else showToast('Opening official form template…', 'success');
        });
      });
    });
    document.getElementById('useful-links-card')?.addEventListener('click', function(e) {
      var link = e.target?.closest?.('.useful-link-btn');
      if (link) {
        e.preventDefault();
        var url = link.dataset.extUrl || link.href;
        if (url && window.api?.openExternal) { window.api.openExternal(url); }
      }
    });
    document.getElementById('splash')?.addEventListener('click', function(e) {
      var link = e.target?.closest?.('.splash-advert-link');
      if (link && link.href && window.api?.openExternal) { e.preventDefault(); window.api.openExternal(link.href); }
    });
    document.getElementById('suggestions-forum-open-btn')?.addEventListener('click', () => {
      var url = (window._appSettingsCache && window._appSettingsCache.suggestionsForumUrl) ? window._appSettingsCache.suggestionsForumUrl : 'https://www.custodynote.com/support';
      if (window.api && window.api.openExternal) {
        window.api.openExternal(url);
      } else {
        window.open(url, '_blank');
      }
    });
    (function initForgotLicence() {
      var btn = document.getElementById('forgot-licence-btn');
      var inp = document.getElementById('forgot-licence-email');
      var msg = document.getElementById('forgot-licence-msg');
      if (!btn || !inp || !msg || !window.custodyNote?.requestLicenceEmail) return;
      btn.addEventListener('click', function() {
        var email = (inp.value || '').trim();
        if (!email) { msg.textContent = 'Enter your email address.'; msg.style.color = ''; return; }
        btn.disabled = true;
        msg.textContent = 'Sending…';
        msg.style.color = '';
        window.custodyNote.requestLicenceEmail(email).then(function(res) {
          msg.textContent = res && res.message ? res.message : 'If that email exists in our system, your licence code has been sent.';
          msg.style.color = 'var(--success-color,#16a34a)';
          btn.disabled = false;
        }).catch(function() {
          msg.textContent = 'If that email exists in our system, your licence code has been sent.';
          msg.style.color = 'var(--success-color,#16a34a)';
          btn.disabled = false;
        });
      });
    })();

    (function initAdminLicencePanel() {
      if (!window.custodyNote) return;
      var panel = document.getElementById('admin-licence-panel');
      var setupSection = document.getElementById('admin-setup-section');
      var loginSection = document.getElementById('admin-login-section');
      var contentSection = document.getElementById('admin-content-section');
      var setupTokenInp = document.getElementById('admin-setup-token-inp');
      var setupPasswordInp = document.getElementById('admin-setup-password-inp');
      var setupBtn = document.getElementById('admin-setup-btn');
      var setupMsg = document.getElementById('admin-setup-msg');
      var pwInp = document.getElementById('admin-password-inp');
      var loginBtn = document.getElementById('admin-login-btn');
      var loginMsg = document.getElementById('admin-login-msg');
      var searchInp = document.getElementById('admin-search-inp');
      var searchBtn = document.getElementById('admin-search-btn');
      var syncBtn = document.getElementById('admin-sync-btn');
      var syncMsg = document.getElementById('admin-sync-msg');
      var resultsEl = document.getElementById('admin-results');
      var closeBtn = document.getElementById('admin-close-btn');
      if (!panel || !loginSection || !contentSection) return;

      function showContent(show) {
        if (setupSection) setupSection.style.display = 'none';
        loginSection.style.display = show ? 'none' : 'block';
        contentSection.style.display = show ? 'block' : 'none';
      }

      function escapeHtml(s) {
        if (!s) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }
      function doSearch() {
        var q = (searchInp && searchInp.value) ? searchInp.value.trim() : '';
        custodyNote.adminSearch(q).then(function(r) {
          if (!r || !r.items) { resultsEl.innerHTML = '<p>No results</p>'; return; }
          var html = '<table style="width:100%;border-collapse:collapse;"><tr><th style="text-align:left;padding:0.35rem;">Email</th><th style="text-align:left;">Key</th><th>Status</th><th>Created</th><th></th></tr>';
          r.items.forEach(function(it) {
            var date = it.createdAt ? new Date(it.createdAt).toLocaleDateString() : '-';
            html += '<tr><td style="padding:0.35rem;">' + escapeHtml(it.email || '') + '</td><td><code>' + escapeHtml(it.licenceKeyMasked || '') + '</code></td><td>' + escapeHtml(it.status || '') + '</td><td>' + date + '</td><td><button type="button" class="btn btn-small admin-reveal-btn" data-id="' + escapeHtml(it.id) + '">Reveal</button> <button type="button" class="btn btn-small admin-resend-btn" data-id="' + escapeHtml(it.id) + '">Resend</button></td></tr>';
          });
          html += '</table>';
          resultsEl.innerHTML = html;
          resultsEl.querySelectorAll('.admin-reveal-btn').forEach(function(b) {
            b.addEventListener('click', function() {
              custodyNote.adminRevealLicence(b.dataset.id).then(function(rec) {
                if (rec && rec.licence_key) showToast('Licence: ' + rec.licence_key, 'success');
                else if (rec && rec.error) showToast(rec.error, 'error');
              });
            });
          });
          resultsEl.querySelectorAll('.admin-resend-btn').forEach(function(b) {
            b.addEventListener('click', function() {
              custodyNote.adminResend(b.dataset.id).then(function(r) {
                showToast(r && r.message ? r.message : 'Sent');
              });
            });
          });
        });
      }

      custodyNote.adminHasPassword().then(function(has) {
        if (has) {
          if (setupSection) setupSection.style.display = 'none';
          showContent(false);
        } else {
          if (setupSection) {
            setupSection.style.display = 'block';
            loginSection.style.display = 'none';
            contentSection.style.display = 'none';
          } else {
            loginMsg.textContent = 'Admin not configured. Set ADMIN_SETUP_TOKEN and run setup.';
          }
        }
      });

      if (setupBtn) setupBtn.addEventListener('click', function() {
        var token = setupTokenInp ? setupTokenInp.value.trim() : '';
        var pw = setupPasswordInp ? setupPasswordInp.value : '';
        if (!token || token.length < 16) { setupMsg.textContent = 'Setup token must be at least 16 characters'; return; }
        if (!pw || pw.length < 8) { setupMsg.textContent = 'Password must be at least 8 characters'; return; }
        setupMsg.textContent = '';
        custodyNote.adminSetPassword({ token: token, password: pw }).then(function(r) {
          if (r && r.ok) {
            setupSection.style.display = 'none';
            loginSection.style.display = 'block';
            setupMsg.textContent = '';
            setupTokenInp.value = ''; setupPasswordInp.value = '';
          } else {
            setupMsg.textContent = (r && r.error) ? r.error : 'Setup failed';
          }
        }).catch(function() { setupMsg.textContent = 'Setup failed'; });
      });

      if (loginBtn) loginBtn.addEventListener('click', function() {
        var pw = pwInp ? pwInp.value : '';
        custodyNote.adminLogin(pw).then(function(r) {
          if (r && r.ok) { showContent(true); loginMsg.textContent = ''; doSearch(); }
          else { loginMsg.textContent = (r && r.error) ? r.error : 'Invalid'; }
        });
      });

      if (searchBtn) searchBtn.addEventListener('click', doSearch);
      if (searchInp) searchInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') doSearch(); });

      if (syncBtn) syncBtn.addEventListener('click', function() {
        syncMsg.textContent = 'Syncing…';
        custodyNote.adminSync().then(function(r) {
          syncMsg.textContent = r && r.ok ? 'Synced ' + (r.synced || 0) + ' records.' : ((r && r.reason) ? r.reason : 'Sync failed');
        });
      });

      if (closeBtn) closeBtn.addEventListener('click', function() {
        panel.style.display = 'none';
      });
      panel.addEventListener('click', function(e) {
        if (e.target === panel) panel.style.display = 'none';
      });
    })();

    document.addEventListener('click', function(e) {
      var link = e.target?.closest?.('.support-faq-link');
      if (link && link.dataset?.url) {
        var url = link.dataset.url;
        if (window.api && window.api.openExternal) {
          window.api.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
      }
    });
    var shareAppUrl = 'https://custodynote.com/download';
    document.getElementById('share-app-copy-btn')?.addEventListener('click', function() {
      var btn = this;
      var copy = function() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareAppUrl).then(function() {
            showToast('Link copied to clipboard', 'success');
            btn.textContent = 'Copied!';
            setTimeout(function() { btn.textContent = 'Copy download link'; }, 2000);
          }).catch(function() { showToast('Could not copy', 'error'); });
        } else {
          var ta = document.createElement('textarea');
          ta.value = shareAppUrl;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy');
            showToast('Link copied to clipboard', 'success');
            btn.textContent = 'Copied!';
            setTimeout(function() { btn.textContent = 'Copy download link'; }, 2000);
          } catch (_) { showToast('Could not copy', 'error'); }
          document.body.removeChild(ta);
        }
      };
      copy();
    });
    document.getElementById('share-app-email-btn')?.addEventListener('click', function() {
      var subject = encodeURIComponent('Custody Note – custody notes app for police station reps');
      var body = encodeURIComponent(
        'I use Custody Note for custody notes and police station attendances — it\'s built for reps and criminal solicitors.\n\nDownload: ' + shareAppUrl + '\n\n30-day free trial, no credit card.'
      );
      var mailto = 'mailto:?subject=' + subject + '&body=' + body;
      if (window.api && window.api.openExternal) {
        window.api.openExternal(mailto);
      } else {
        window.location.href = mailto;
      }
    });

    const settingsFields = [
      ['setting-email', 'email'],
      ['setting-dscc-pin', 'dsccPin'],
      ['setting-quickfile-account', 'quickfileAccountNumber'],
      ['setting-quickfile-apikey', 'quickfileApiKey'],
      ['setting-quickfile-appid', 'quickfileAppId'],
      ['setting-backup-folder', 'backupFolder'],
      ['setting-offsite-backup-folder', 'offsiteBackupFolder'],
      ['setting-cloud-backup-url', 'cloudBackupUrl'],
      ['setting-cloud-backup-token', 'cloudBackupToken'],
      ['suggestions-forum-url', 'suggestionsForumUrl'],
      ['setting-auto-import-folder', 'autoImportFolder']
    ];
    settingsFields.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', debounce((e) => {
          const val = e.target.value.trim();
          window.api.setSettings({ [key]: val }).then(showSettingsSavedToast);
        }, 800));
      }
    });

    // Fee earner name — was missing auto-save, so changes were lost on restart
    document.getElementById('setting-fee-earner-name')?.addEventListener('input', debounce((e) => {
      window.api.setSettings({ feeEarnerNameDefault: e.target.value.trim() }).then(showSettingsSavedToast);
    }, 800));

    // LAA rate fields — save all rates as a JSON blob whenever any rate changes
    function saveLaaRates() {
      const rates = {
        fixedFee: document.getElementById('rate-fixedFee')?.value || '320.00',
        escapeThreshold: document.getElementById('rate-escapeThreshold')?.value || '650.00',
        attendanceSocial: document.getElementById('rate-attendanceSocial')?.value || '62.16',
        attendanceUnsocial: document.getElementById('rate-attendanceUnsocial')?.value || '77.68',
        travelWaiting: document.getElementById('rate-travelWaiting')?.value || '30.36',
        mileage: document.getElementById('rate-mileage')?.value || '0.45',
        vat: document.getElementById('rate-vat')?.value || '20',
      };
      // Also update the in-memory LAA object so fee calculations use new rates immediately
      if (rates.fixedFee) LAA.fixedFee = +rates.fixedFee;
      if (rates.escapeThreshold) LAA.escapeThreshold = +rates.escapeThreshold;
      if (rates.attendanceSocial) LAA.national.attendance.social = +rates.attendanceSocial;
      if (rates.attendanceUnsocial) LAA.national.attendance.unsocial = +rates.attendanceUnsocial;
      if (rates.travelWaiting) { LAA.national.travel.social = +rates.travelWaiting; LAA.national.travel.unsocial = +rates.travelWaiting; LAA.national.waiting.social = +rates.travelWaiting; LAA.national.waiting.unsocial = +rates.travelWaiting; }
      if (rates.mileage) LAA.mileageRate = +rates.mileage;
      if (rates.vat) LAA.vatRate = +rates.vat / 100;
      window.api.setSettings({ laaRates: JSON.stringify(rates) }).then(showSettingsSavedToast);
    }
    ['rate-fixedFee','rate-escapeThreshold','rate-attendanceSocial','rate-attendanceUnsocial','rate-travelWaiting','rate-mileage','rate-vat'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', debounce(saveLaaRates, 600));
    });

    document.getElementById('setting-dark-mode')?.addEventListener('change', (e) => {
      applyDarkMode(e.target.checked);
      window.api.setSettings({ darkMode: e.target.checked ? 'true' : 'false' }).then(showSettingsSavedToast);
    });

    document.getElementById('theme-picker')?.addEventListener('click', (e) => {
      var btn = e.target.closest('.theme-swatch');
      if (!btn) return;
      var theme = btn.getAttribute('data-theme') || 'default';
      applyTheme(theme);
      window.api.setSettings({ colourTheme: theme }).then(showSettingsSavedToast);
    });

    document.getElementById('setting-font-size')?.addEventListener('input', (e) => {
      const sz = e.target.value;
      applyFontSize(sz);
      document.getElementById('font-size-val').textContent = sz + 'px';
      window.api.setSettings({ fontSize: sz }).then(showSettingsSavedToast);
    });

    document.getElementById('validation-close')?.addEventListener('click', () => {
      document.getElementById('validation-modal')?.classList.add('hidden');
    });
    document.getElementById('validation-finalise-anyway')?.addEventListener('click', () => {
      showConfirm('Are you sure? Incomplete records may cause the firm billing difficulties.').then(ok => {
        if (!ok) return;
        document.getElementById('validation-modal')?.classList.add('hidden');
        collectCurrentData();
        const c = typeof calculateProfitCosts === 'function' && calculateProfitCosts();
        if (c && c.isEscape) {
          showConfirm('ESCAPE CASE – Submit CRM18 to claim at hourly rates. Continue to finalise?').then(ok2 => {
            if (ok2) saveForm('finalised');
          });
        } else {
          saveForm('finalised');
        }
      });
    });
    document.getElementById('validation-modal')?.addEventListener('click', e => {
      if (e.target.id === 'validation-modal') e.target.classList.add('hidden');
    });

    document.addEventListener('click', function (e) {
      if (_clientDropdown && !_clientDropdown.contains(e.target)) hideClientDropdown();
    });

    purgeEmptyDrafts().then(() => {
      showView('home');
    }).catch(function(err) {
      console.error('[init] purgeEmptyDrafts failed:', err);
      showView('home');
    });
  }

  function openLaaForm(formType, sourceData) {
    var data = sourceData || formData || {};
    var formNames = {
      crm1: 'CRM1 — Client Details',
      crm2: 'CRM2 — Advice & Assistance',
      crm3: 'CRM3 — Advocacy Assistance',
      declaration: 'Applicant Declaration'
    };
    var title = formNames[formType] || formType;
    if (!window.api || !window.api.laaGenerateOfficialPdf) {
      showToast('Official PDF generation not available', 'error');
      return;
    }

    var needsClientSig = !data.clientSig;
    var needsFeeEarnerSig = !data.feeEarnerSig;
    var sigQueue = [];
    if (needsClientSig) sigQueue.push({ sigKey: 'clientSig', label: 'Client Signature — ' + title });
    if (needsFeeEarnerSig) sigQueue.push({ sigKey: 'feeEarnerSig', label: 'Fee Earner Signature — ' + title });

    if (sigQueue.length > 0) {
      collectSignaturesThenGenerate(sigQueue, 0, data, formType, title);
    } else {
      generateLaaFormPdf(formType, title, data);
    }
  }

  function collectSignaturesThenGenerate(sigQueue, idx, data, formType, title) {
    if (idx >= sigQueue.length) {
      generateLaaFormPdf(formType, title, data);
      return;
    }
    var entry = sigQueue[idx];
    openStandaloneSignature(entry.sigKey, entry.label, function(dataUri) {
      data[entry.sigKey] = dataUri;
      formData[entry.sigKey] = dataUri;
      var now = new Date();
      var date = now.toISOString().slice(0, 10);
      var time = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      setFieldValueSilent('laaSignatureDate', date);
      setFieldValueSilent('laaSignatureTime', time);
      formData.laaSignatureDate = date;
      formData.laaSignatureTime = time;
      data.laaSignatureDate = date;
      data.laaSignatureTime = time;
      quietSave();
      collectSignaturesThenGenerate(sigQueue, idx + 1, data, formType, title);
    }, function() {
      showToast('Form generation cancelled — signature required', 'error');
    });
  }

  function openStandaloneSignature(sigKey, label, onDone, onCancel) {
    var overlay = document.createElement('div');
    overlay.className = 'sig-fullscreen-overlay';
    var titleEl = document.createElement('div');
    titleEl.className = 'sig-fs-label';
    titleEl.textContent = label || 'Signature';
    overlay.appendChild(titleEl);

    var hint = document.createElement('div');
    hint.style.cssText = 'color:#94a3b8;font-size:0.85rem;margin-bottom:0.5rem;text-align:center;';
    hint.textContent = 'Please sign below using your finger or mouse, then press Done.';
    overlay.appendChild(hint);

    var fsCanvas = document.createElement('canvas');
    fsCanvas.width = 1200; fsCanvas.height = 500;
    overlay.appendChild(fsCanvas);

    var btnRow = document.createElement('div');
    btnRow.className = 'sig-fs-buttons';
    var clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear'; clearBtn.className = 'sig-fs-btn-clear';
    var doneBtn = document.createElement('button');
    doneBtn.textContent = 'Done'; doneBtn.className = 'sig-fs-btn-done';
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel'; cancelBtn.className = 'sig-fs-btn-cancel';
    btnRow.appendChild(clearBtn); btnRow.appendChild(doneBtn); btnRow.appendChild(cancelBtn);
    overlay.appendChild(btnRow);
    document.body.appendChild(overlay);

    var ctx = fsCanvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, fsCanvas.width, fsCanvas.height);
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 3; ctx.lineCap = 'round';

    var drawing = false; var hasDrawn = false; var lastTouchEnd = 0;
    var ignoreMouse = function() { return Date.now() - lastTouchEnd < 500; };
    fsCanvas.addEventListener('mousedown', function(e) { if (ignoreMouse()) return; drawing = true; hasDrawn = true; var p = getCanvasCoords(fsCanvas, e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    fsCanvas.addEventListener('mousemove', function(e) { if (ignoreMouse() || !drawing) return; var p = getCanvasCoords(fsCanvas, e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    fsCanvas.addEventListener('mouseup', function() { if (ignoreMouse()) return; drawing = false; });
    fsCanvas.addEventListener('mouseleave', function() { drawing = false; });
    fsCanvas.addEventListener('touchstart', function(e) { if (!e.touches.length) return; drawing = true; hasDrawn = true; var p = getCanvasCoords(fsCanvas, e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: true });
    fsCanvas.addEventListener('touchmove', function(e) { if (!drawing || !e.touches.length) return; e.preventDefault(); var p = getCanvasCoords(fsCanvas, e); ctx.lineTo(p.x, p.y); ctx.stroke(); }, { passive: false });
    fsCanvas.addEventListener('touchend', function() { drawing = false; lastTouchEnd = Date.now(); }, { passive: true });
    fsCanvas.addEventListener('touchcancel', function() { drawing = false; lastTouchEnd = Date.now(); }, { passive: true });
    clearBtn.addEventListener('click', function() { hasDrawn = false; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, fsCanvas.width, fsCanvas.height); ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 3; ctx.lineCap = 'round'; });
    doneBtn.addEventListener('click', function() {
      if (!hasDrawn) { showToast('Please sign before pressing Done', 'error'); return; }
      var dataUri = fsCanvas.toDataURL();
      document.body.removeChild(overlay);
      if (onDone) onDone(dataUri);
    });
    cancelBtn.addEventListener('click', function() {
      document.body.removeChild(overlay);
      if (onCancel) onCancel();
    });
  }

  function generateLaaFormPdf(formType, title, data) {
    showToast('Generating ' + title + ' PDF…', 'info');
    window.api.laaGenerateOfficialPdf({ formType: formType, data: data }).then(function(result) {
      if (result.error) {
        showToast('PDF error: ' + result.error, 'error');
        return;
      }
      showPdfPreview(result.path, title, data, formType);
    }).catch(function(err) {
      showToast('PDF failed: ' + (err && err.message || err), 'error');
    });
  }

  function showPdfPreview(pdfPath, title, data, formType) {
    var existing = document.getElementById('laa-form-preview-modal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'laa-form-preview-modal';
    modal.className = 'laa-preview-overlay';

    var sigStatus = '';
    if (data.clientSig) sigStatus += '<span style="color:#22c55e;font-size:0.8rem;margin-right:0.75rem;" title="Client has signed">&#10003; Client signed</span>';
    else sigStatus += '<span style="color:#ef4444;font-size:0.8rem;margin-right:0.75rem;" title="Client has NOT signed">&#10007; Client unsigned</span>';
    if (data.feeEarnerSig) sigStatus += '<span style="color:#22c55e;font-size:0.8rem;" title="Fee earner has signed">&#10003; Fee earner signed</span>';
    else sigStatus += '<span style="color:#ef4444;font-size:0.8rem;" title="Fee earner has NOT signed">&#10007; Fee earner unsigned</span>';

    modal.innerHTML =
      '<div class="laa-preview-container">' +
        '<div class="laa-preview-header">' +
          '<span class="laa-preview-title">' + esc(title) + ' Preview</span>' +
          '<div style="display:flex;align-items:center;gap:0.5rem;">' +
            sigStatus +
            '<button type="button" class="btn btn-secondary laa-preview-close">Close</button>' +
          '</div>' +
        '</div>' +
        '<iframe class="laa-preview-frame"></iframe>' +
        '<div class="laa-output-bar">' +
          '<button type="button" class="btn btn-secondary laa-btn-resign" title="Re-sign and regenerate the form">Re-sign</button>' +
          '<button type="button" class="btn btn-secondary laa-btn-preview" title="Open in default PDF viewer">Print Preview</button>' +
          '<button type="button" class="btn btn-primary laa-btn-pdf" title="PDF already saved to Desktop">Save as PDF</button>' +
          '<button type="button" class="btn btn-secondary laa-btn-email" title="Open email with form details">Email</button>' +
          '<button type="button" class="btn btn-secondary laa-btn-print" title="Send to printer">Print</button>' +
        '</div>' +
      '</div>';
    document.getElementById('app').appendChild(modal);
    var iframe = modal.querySelector('.laa-preview-frame');
    iframe.src = pdfPath;

    modal.querySelector('.laa-preview-close').addEventListener('click', function() { modal.remove(); });

    modal.querySelector('.laa-btn-resign').addEventListener('click', function() {
      modal.remove();
      var sigQueue = [
        { sigKey: 'clientSig', label: 'Client Signature — ' + title },
        { sigKey: 'feeEarnerSig', label: 'Fee Earner Signature — ' + title }
      ];
      collectSignaturesThenGenerate(sigQueue, 0, data, formType, title);
    });

    modal.querySelector('.laa-btn-preview').addEventListener('click', function() {
      window.api.openPath(pdfPath);
    });

    modal.querySelector('.laa-btn-pdf').addEventListener('click', function() {
      showToast('PDF already saved: ' + pdfPath.replace(/\\/g, '/').split('/').pop(), 'success');
    });

    modal.querySelector('.laa-btn-email').addEventListener('click', function() {
      window.api.getSettings().then(function(s) {
        var solicitorEmail = (data.firmContactEmail || '').trim();
        var fallbackEmail = (s.email || '').trim();
        var email = solicitorEmail || fallbackEmail;
        if (!email) { showToast('No solicitor email found on record and no email set in Settings', 'error'); return; }
        var recipientLabel = solicitorEmail ? (data.firmContactName || 'instructing solicitor') : 'your email';
        var clientName = [data.forename, data.surname].filter(Boolean).join(' ');
        var fileName = pdfPath.replace(/\\/g, '/').split('/').pop();
        var subj = encodeURIComponent(title + ' \u2013 ' + clientName);
        var body = encodeURIComponent(
          'Dear ' + (data.firmContactName || 'Sir/Madam') +
          ',\n\nPlease find the ' + title + ' form attached for ' +
          (clientName || 'the above client') +
          '.\n\nFile: ' + fileName +
          '\n\nKind regards'
        );
        window.api.openExternal('mailto:' + email + '?subject=' + subj + '&body=' + body);
        showToast('Emailing to ' + recipientLabel + ' (' + email + '). Attach: ' + fileName, 'success', 5000);
      });
    });

    modal.querySelector('.laa-btn-print').addEventListener('click', function() {
      showToast('Opening print dialog…', 'info');
      window.api.printPdfFile(pdfPath).then(function(res) {
        if (res && res.error) showToast('Print error: ' + res.error, 'error');
      }).catch(function(err) {
        showToast('Print failed: ' + (err && err.message || err), 'error');
      });
    });

    modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  }


  function showLaaFormsPopup() {
    collectCurrentData();
    var existing = document.getElementById('laa-forms-popup');
    if (existing) { existing.remove(); return; }
    var popup = document.createElement('div');
    popup.id = 'laa-forms-popup';
    popup.className = 'sections-index';
    popup.innerHTML =
      '<div class="sections-index-content">' +
        '<h3>Generate LAA Form</h3>' +
        '<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.75rem;">Pre-populated from this attendance record.</p>' +
        '<ul style="list-style:none;">' +
          '<li class="laa-popup-item" data-form="crm1">CRM1 \u2014 Client Details</li>' +
          '<li class="laa-popup-item" data-form="crm2">CRM2 \u2014 Advice & Assistance</li>' +
          '<li class="laa-popup-item" data-form="crm3">CRM3 \u2014 Advocacy Assistance</li>' +
          '<li class="laa-popup-item" data-form="declaration">Applicant Declaration</li>' +
        '</ul>' +
        '<button type="button" class="btn btn-secondary" style="margin-top:0.75rem;width:100%;" id="laa-popup-close">Close</button>' +
      '</div>';
    document.getElementById('view-form').appendChild(popup);
    popup.querySelectorAll('.laa-popup-item').forEach(function(li) {
      li.style.cssText = 'padding:0.6rem 0.75rem;margin-bottom:0.25rem;border-radius:6px;cursor:pointer;font-size:0.9rem;font-weight:600;color:var(--text);';
      li.addEventListener('mouseenter', function() { this.style.background = 'var(--section-bg)'; });
      li.addEventListener('mouseleave', function() { this.style.background = ''; });
      li.addEventListener('click', function() {
        popup.remove();
        openLaaForm(this.dataset.form, formData);
      });
    });
    popup.querySelector('#laa-popup-close').addEventListener('click', function() { popup.remove(); });
    popup.addEventListener('click', function(e) { if (e.target === popup) popup.remove(); });
  }

  function showLaaFormPicker(formType) {
    var formNames = { crm1: 'CRM1 \u2014 Client Details', crm2: 'CRM2 \u2014 Advice & Assistance', crm3: 'CRM3 \u2014 Advocacy Assistance', declaration: 'Applicant Declaration' };
    var modal = document.getElementById('attendance-picker-modal');
    var titleEl = document.getElementById('attendance-picker-title');
    var listEl = document.getElementById('attendance-picker-list');
    if (!modal || !listEl) return;
    titleEl.textContent = 'Select attendance for ' + (formNames[formType] || formType);
    listEl.innerHTML = '<li class="home-recent-empty">Loading\u2026</li>';
    modal.classList.remove('hidden');
    var listFn = window.api.attendanceListFull || window.api.attendanceList;
    listFn().then(function(rows) {
      if (!rows || !rows.length) {
        listEl.innerHTML = '<li class="home-recent-empty">No attendances found. Create one first.</li>';
        return;
      }
      var sorted = rows.slice().sort(function(a, b) { return (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''); });
      listEl.innerHTML = sorted.map(function(r) {
        var name = (r.client_name && String(r.client_name).trim()) || 'Draft (no name)';
        var station = r.station_name || '';
        var date = r.attendance_date || '';
        if (date) {
          var dm = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (dm) date = dm[3] + '/' + dm[2] + '/' + dm[1];
        }
        var meta = [station, date].filter(Boolean).join(' \u00B7 ');
        return '<li class="attendance-picker-item" data-id="' + r.id + '"><span class="picker-item-name">' + esc(name) + '</span><span class="picker-item-meta">' + esc(meta) + '</span></li>';
      }).join('');
      listEl.querySelectorAll('.attendance-picker-item').forEach(function(li) {
        var id = parseInt(li.dataset.id, 10);
        if (isNaN(id)) return;
        li.addEventListener('click', function() {
          modal.classList.add('hidden');
          window.api.attendanceGet(id).then(function(row) {
            if (!row || !row.data) { showToast('Could not load attendance', 'error'); return; }
            var data = safeJson(row.data);
            openLaaForm(formType, data);
          }).catch(function(err) {
            showToast('Failed to load attendance: ' + (err && err.message), 'error');
          });
        });
      });
    }).catch(function() {
      listEl.innerHTML = '<li class="home-recent-empty">Failed to load list.</li>';
      showToast('Failed to load attendances', 'error');
    });
  }

  function showLaaFormsNav() {
    var existing = document.getElementById('laa-nav-popup');
    if (existing) { existing.remove(); return; }
    var overlay = document.createElement('div');
    overlay.id = 'laa-nav-popup';
    overlay.className = 'sections-index';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:900;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);';
    overlay.innerHTML =
      '<div class="sections-index-content" style="max-width:360px;width:90%;">' +
        '<h3>Generate LAA Form</h3>' +
        '<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.75rem;">Select a form to generate. Data will be pre-populated from the most recent record if available.</p>' +
        '<ul style="list-style:none;">' +
          '<li class="laa-popup-item" data-form="crm1">CRM1 \u2014 Client Details</li>' +
          '<li class="laa-popup-item" data-form="crm2">CRM2 \u2014 Advice & Assistance</li>' +
          '<li class="laa-popup-item" data-form="crm3">CRM3 \u2014 Advocacy Assistance</li>' +
          '<li class="laa-popup-item" data-form="declaration">Applicant Declaration</li>' +
        '</ul>' +
        '<button type="button" class="btn btn-secondary" style="margin-top:0.75rem;width:100%;" id="laa-nav-popup-close">Close</button>' +
      '</div>';
    document.getElementById('app').appendChild(overlay);
    overlay.querySelectorAll('.laa-popup-item').forEach(function(li) {
      li.style.cssText = 'padding:0.6rem 0.75rem;margin-bottom:0.25rem;border-radius:6px;cursor:pointer;font-size:0.9rem;font-weight:600;color:var(--text);';
      li.addEventListener('mouseenter', function() { this.style.background = 'var(--section-bg)'; });
      li.addEventListener('mouseleave', function() { this.style.background = ''; });
      li.addEventListener('click', function() {
        overlay.remove();
        openLaaForm(this.dataset.form);
      });
    });
    overlay.querySelector('#laa-nav-popup-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  /* ─── First-launch setup modal ─── */
  function initFirstLaunchModal() {
    var modal = document.getElementById('first-launch-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    document.getElementById('fl-save').addEventListener('click', function() {
      var name = (document.getElementById('fl-fee-earner-name').value || '').trim();
      var pin = (document.getElementById('fl-dscc-pin').value || '').trim();
      if (!name) { showToast('Please enter your fee earner name', 'error'); return; }
      if (!pin) { showToast('Please enter your DSCC PIN/number', 'error'); return; }
      window.api.setSettings({
        dsccPin: pin,
        feeEarnerNameDefault: name,
      }).then(function() {
        modal.style.display = 'none';
        showToast('Setup saved — welcome to Custody Note, ' + name + '!', 'success', 4000);
      });
    });

    document.getElementById('fl-skip').addEventListener('click', function() {
      modal.style.display = 'none';
      var banner = document.createElement('div');
      banner.className = 'setup-warning-banner';
      banner.textContent = 'Setup incomplete — click here to add your name and DSCC PIN (required for billing)';
      banner.addEventListener('click', function() {
        showView('settings');
        banner.remove();
      });
      document.querySelector('.app-header')?.insertAdjacentElement('afterend', banner);
    });
  }

function safeInit() {
  try {
    init();
  } catch (err) {
    console.error('[init] FATAL ERROR in init():', err);
  }
}
function gatedInit() {
  if (typeof window.onLicenceReady === 'function') {
    window.onLicenceReady(safeInit);
  } else {
    safeInit();
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', gatedInit);
else gatedInit();
