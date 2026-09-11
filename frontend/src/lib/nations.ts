type NationOverride = {
  region: string
  en: string
  zh: string
  flag?: string
}

const nationRegions: Record<number, string> = {
  5: "DZ", 6: "AO", 7: "BJ", 8: "BW", 9: "BF", 10: "BI", 11: "CM", 12: "CV", 13: "CF", 14: "TD",
  15: "DJ", 16: "EG", 17: "GQ", 18: "ET", 19: "GA", 20: "GM", 21: "GH", 22: "GN", 23: "GW", 24: "CI",
  25: "KE", 26: "LS", 27: "LR", 28: "LY", 29: "MG", 30: "MW", 31: "ML", 32: "MR", 33: "MU", 34: "MA",
  35: "MZ", 36: "NA", 37: "NE", 38: "NG", 39: "RW", 40: "ST", 41: "SN", 42: "SC", 43: "SL", 44: "SO",
  45: "ZA", 46: "SD", 47: "SZ", 48: "TZ", 49: "CG", 50: "TG", 51: "TN", 52: "UG", 53: "CD", 54: "ZM", 55: "ZW",
  106: "AF", 107: "BH", 108: "BD", 109: "BN", 110: "CN", 111: "HK", 112: "IN", 113: "ID", 114: "IR", 115: "IQ",
  116: "JP", 117: "JO", 118: "KH", 119: "KZ", 120: "KW", 121: "KG", 122: "LA", 123: "LB", 124: "MO", 125: "MY",
  126: "MV", 127: "MM", 128: "NP", 129: "KP", 130: "OM", 131: "PK", 132: "QA", 133: "SA", 134: "SG", 135: "KR",
  136: "LK", 137: "SY", 138: "TW", 139: "TJ", 140: "TH", 141: "PH", 142: "TM", 143: "AE", 144: "UZ", 145: "VN", 146: "YE",
  359: "AG", 360: "AW", 361: "BB", 362: "BZ", 363: "BM", 364: "CA", 365: "KY", 366: "CR", 367: "CU", 368: "DM",
  370: "SV", 371: "GD", 373: "GT", 374: "GY", 375: "HT", 376: "HN", 377: "JM", 379: "MX", 380: "CW", 381: "NI",
  382: "PA", 383: "PR", 384: "LC", 385: "KN", 386: "VC", 387: "SR", 388: "BS", 389: "TT", 390: "US",
  752: "AL", 753: "AD", 754: "AM", 755: "AT", 756: "AZ", 757: "BE", 758: "BY", 759: "BA", 760: "BG", 761: "HR",
  762: "CY", 763: "CZ", 764: "DK", 765: "GB", 766: "EE", 767: "FO", 768: "FI", 769: "FR", 770: "GE", 771: "DE",
  772: "GR", 773: "HU", 774: "IS", 775: "IL", 776: "IT", 777: "LV", 778: "LI", 779: "LT", 780: "LU", 781: "MK",
  782: "MT", 783: "MD", 784: "NL", 785: "GB", 786: "NO", 787: "PL", 788: "PT", 789: "IE", 790: "RO", 791: "RU",
  792: "SM", 793: "GB", 794: "SK", 795: "SI", 796: "ES", 797: "SE", 798: "CH", 799: "TR", 800: "UA", 801: "GB", 802: "RS",
  1435: "AU", 1436: "CK", 1437: "FJ", 1438: "NZ", 1439: "PG", 1440: "SB", 1441: "PF", 1442: "TO", 1443: "VU", 1444: "WS",
  1649: "AR", 1650: "BO", 1651: "BR", 1652: "CL", 1653: "CO", 1654: "EC", 1655: "PY", 1656: "PE", 1657: "UY", 1658: "VE",
  1662: "PS", 129504: "AS", 129505: "MN", 129508: "GU", 129511: "ER", 129514: "AI", 129517: "VG", 129520: "MS",
  129523: "VI", 129526: "TC", 129532: "NC", 131012: "BT", 142527: "DO", 209002: "KI", 214394: "GI", 214395: "BQ",
  217945: "XK", 917496: "GF", 917498: "GP", 917502: "MQ", 917506: "SX", 917508: "MF", 917510: "RE", 918740: "YT",
  918745: "WF", 918748: "PM", 919586: "KM", 5626837: "TL", 8162661: "MC", 13100103: "TZ", 13113220: "SS",
  15064643: "FM", 23008660: "MP", 23088616: "TV", 62002127: "ME", 82082526: "BL",
}

const overrides: Record<number, NationOverride> = {
  138: { region: "TW", en: "Chinese Taipei", zh: "中华台北" },
  765: { region: "GB", en: "England", zh: "英格兰", flag: subdivisionFlag("gbeng") },
  785: { region: "GB", en: "Northern Ireland", zh: "北爱尔兰" },
  793: { region: "GB", en: "Scotland", zh: "苏格兰", flag: subdivisionFlag("gbsct") },
  801: { region: "GB", en: "Wales", zh: "威尔士", flag: subdivisionFlag("gbwls") },
  13100103: { region: "TZ", en: "Zanzibar", zh: "桑给巴尔" },
  217945: { region: "XK", en: "Kosovo", zh: "科索沃" },
}

export type NationDisplay = {
  flag: string
  name: string
}

export function nationDisplay(uid: number | undefined, language: string): NationDisplay | undefined {
  if (uid == null) return undefined
  const override = overrides[uid]
  const region = override?.region ?? nationRegions[uid]
  if (!region) return undefined
  const localizedName = override
    ? language.startsWith("zh") ? override.zh : override.en
    : displayRegion(region, language)
  return {
    flag: override?.flag ?? regionFlag(region),
    name: localizedName ?? `Nation ${uid}`,
  }
}

function displayRegion(region: string, language: string): string | undefined {
  try {
    return new Intl.DisplayNames([language], { type: "region" }).of(region)
  } catch {
    return undefined
  }
}

function regionFlag(region: string): string {
  if (!/^[A-Z]{2}$/.test(region)) return "🏳️"
  return String.fromCodePoint(...[...region].map((character) => 0x1f1e6 + character.charCodeAt(0) - 65))
}

function subdivisionFlag(code: string): string {
  return String.fromCodePoint(0x1f3f4, ...[...code].map((character) => 0xe0061 + character.charCodeAt(0) - 97), 0xe007f)
}
