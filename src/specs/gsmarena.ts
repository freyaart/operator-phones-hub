import type { PhoneTechnicalSpecs } from './phone-technical-specs.js';

type PhoneModelForMatch = {
  slug: string;
  brand: string;
  series: string;
  marketingName: string | null;
};

export type GsmarenaCandidate = {
  title: string;
  url: string;
  query: string;
  score: number;
};

export type GsmarenaParsedSpec = {
  matched: GsmarenaCandidate;
  marketingName: string;
  releaseYear: number | null;
  specs: PhoneTechnicalSpecs;
};

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function decodeHtml(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&Prime;/g, '″')
    .replace(/&prime;/g, '′');
}

function stripHtml(input: string): string {
  return decodeHtml(input).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeMatchText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => value != null))].sort((a, b) => a - b);
}

function maxNumber(values: Array<number | null | undefined>): number | undefined {
  const filtered = values.filter((value): value is number => value != null);
  return filtered.length > 0 ? Math.max(...filtered) : undefined;
}

function absoluteUrl(url: string): string {
  return url.startsWith('http') ? url : `https://www.gsmarena.com/${url.replace(/^\/+/, '')}`;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`GSMArena request failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function parseSearchResults(html: string, query: string): GsmarenaCandidate[] {
  const candidates: GsmarenaCandidate[] = [];
  const regex =
    /<li><a href="([^"]+\.php)"[^>]*>[\s\S]*?<strong><span>([\s\S]*?)<\/span><\/strong><\/a><\/li>/gi;
  for (const match of html.matchAll(regex)) {
    const url = absoluteUrl(match[1]);
    const title = stripHtml(match[2]).replace(/\s+/g, ' ');
    candidates.push({ title, url, query, score: 0 });
  }
  return candidates;
}

function scoreCandidate(model: PhoneModelForMatch, candidate: GsmarenaCandidate): number {
  const brand = normalizeMatchText(model.brand);
  const target = normalizeMatchText(model.marketingName ?? model.series);
  const slugTarget = normalizeMatchText(model.slug.replace(/-/g, ' '));
  const normalizedTitle = normalizeMatchText(candidate.title);

  const targetTokens = new Set(target.split(' ').filter(Boolean));
  const titleTokens = new Set(normalizedTitle.split(' ').filter(Boolean));
  let score = 0;

  if (normalizedTitle === `${brand} ${target}`.trim()) score += 200;
  if (normalizedTitle === target) score += 180;
  if (normalizedTitle.includes(target)) score += 80;
  if (normalizedTitle.includes(slugTarget)) score += 60;
  if (normalizedTitle.startsWith(brand)) score += 20;

  for (const token of targetTokens) {
    if (titleTokens.has(token)) score += 8;
  }

  if (model.brand.toLowerCase() === 'apple' && normalizedTitle.includes('iphone')) {
    score += 10;
  }

  score -= Math.abs(titleTokens.size - targetTokens.size);
  return score;
}

function buildQueries(model: PhoneModelForMatch): string[] {
  return [...new Set([`${model.brand} ${model.marketingName ?? model.series}`, model.marketingName ?? model.series, model.series])];
}

export async function findBestGsmarenaMatch(model: PhoneModelForMatch): Promise<GsmarenaCandidate | null> {
  let best: GsmarenaCandidate | null = null;

  for (const query of buildQueries(model)) {
    const url = `https://www.gsmarena.com/results.php3?sName=${encodeURIComponent(query)}&sQuickSearch=yes`;
    const html = await fetchText(url);
    for (const candidate of parseSearchResults(html, query)) {
      candidate.score = scoreCandidate(model, candidate);
      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }
    if (best && best.score >= 180) break;
  }

  return best && best.score >= 30 ? best : null;
}

function parseSpecTables(html: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const comment = html.match(/<p[^>]+data-spec="comment"[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  if (comment) {
    out.Meta = { Comment: stripHtml(comment) };
  }

  const tables = html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi);
  for (const table of tables) {
    let currentSection = '';
    let lastLabel = '';
    for (const row of table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = row[1];
      const section = rowHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/i)?.[1];
      if (section) currentSection = stripHtml(section);
      if (!currentSection) continue;

      const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => stripHtml(cell[1]));
      if (cells.length === 0) continue;

      const label = cells[0] || '';
      const value = cells[cells.length - 1] || '';
      if (!value) continue;

      out[currentSection] ??= {};
      if (!label || label === '\u00a0') {
        if (lastLabel) {
          out[currentSection][lastLabel] = `${out[currentSection][lastLabel]}\n${value}`.trim();
        }
        continue;
      }

      out[currentSection][label] = out[currentSection][label]
        ? `${out[currentSection][label]}\n${value}`.trim()
        : value;
      lastLabel = label;
    }
  }

  return out;
}

function getSpec(specs: Record<string, Record<string, string>>, section: string, label: string): string | undefined {
  return specs[section]?.[label];
}

function parseResolution(value: string | undefined) {
  const match = value?.match(/(\d+)\s*x\s*(\d+)/i);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : undefined;
}

function parseAspectRatio(value: string | undefined): string | undefined {
  return value?.match(/(\d+(?:\.\d+)?:\d+)\s*ratio/i)?.[1];
}

function parseFloatValue(value: string | undefined, regex: RegExp): number | undefined {
  const match = value?.match(regex);
  return match ? Number(match[1]) : undefined;
}

function parseStorageGb(token: string): number | null {
  const match = token.match(/(\d+(?:\.\d+)?)\s*(TB|GB)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2].toUpperCase() === 'TB' ? amount * 1024 : amount;
}

function parseCameraModules(raw: string | undefined) {
  if (!raw) return undefined;
  const modules = raw.match(/\d+\s*MP[\s\S]*?(?=(?:\d+\s*MP\b)|$)/g) ?? [];
  if (modules.length === 0) return undefined;

  return modules.map((item) => {
    const compact = item.replace(/\s+/g, ' ').trim();
    const role =
      compact.match(/\((wide|ultrawide|ultra wide|telephoto|periscope|macro|depth)\)/i)?.[1] ??
      compact.match(/\b(wide|ultrawide|ultra wide|telephoto|periscope|macro|depth)\b/i)?.[1] ??
      undefined;
    return {
      role: role?.replace(/ultra wide/i, 'ultrawide'),
      mp: parseFloatValue(compact, /(\d+(?:\.\d+)?)\s*MP/i),
      aperture: compact.match(/f\/[\d.]+/i)?.[0],
      sensorSizeInch: compact.match(/1\/[\d.]+"/)?.[0],
      ois: /\bOIS\b/i.test(compact),
      focalLengthMmEq: parseFloatValue(compact, /(\d+)\s*mm/i),
    };
  });
}

function parseFrontCamera(raw: string | undefined) {
  if (!raw) return undefined;
  return {
    mp: parseFloatValue(raw, /(\d+(?:\.\d+)?)\s*MP/i),
    aperture: raw.match(/f\/[\d.]+/i)?.[0],
    autofocus: /\bPDAF\b|\bAF\b/i.test(raw),
  };
}

function parseVideoSummary(raw: string | undefined) {
  if (!raw) return undefined;
  const fpsMatches = [...raw.matchAll(/@(\d+)fps/gi)].map((match) => Number(match[1]));
  const hdrModes = [...new Set((raw.match(/HDR10\+?|Dolby Vision HDR|Dolby Vision/gi) ?? []).map((item) => item.trim()))];
  const resolutionLabel =
    raw.match(/\b(8K|6K|4K|1440p|1080p|720p)\b/i)?.[1]?.toUpperCase() ?? undefined;
  return {
    maxResolutionLabel: resolutionLabel,
    maxFps: maxNumber(fpsMatches),
    hdrModes,
  };
}

function parseBuildMaterial(raw: string | undefined, part: 'frame' | 'back'): string | undefined {
  const match = raw?.match(new RegExp(`([a-zA-Z\\- ]+) ${part}`, 'i'));
  return match?.[1]?.trim();
}

function parseFingerprint(sensors: string | undefined): string | undefined {
  const match = sensors?.match(/fingerprint[^,]*/i);
  return match?.[0]?.trim();
}

function parseReleaseYear(value: string | undefined): number | null {
  const year = value?.match(/\b(20\d{2})\b/)?.[1];
  return year ? Number(year) : null;
}

export function parseGsmarenaSpecPage(html: string, matched: GsmarenaCandidate): GsmarenaParsedSpec {
  const title = stripHtml(html.match(/<h1[^>]+class="specs-phone-name-title"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  const specs = parseSpecTables(html);

  const displayType = getSpec(specs, 'Display', 'Type');
  const displaySize = getSpec(specs, 'Display', 'Size');
  const displayResolution = getSpec(specs, 'Display', 'Resolution');
  const platformOs = getSpec(specs, 'Platform', 'OS');
  const memoryInternal = getSpec(specs, 'Memory', 'Internal');
  const memoryExtra = getSpec(specs, 'Memory', 'Card slot');
  const mainCamera = getSpec(specs, 'Main Camera', 'Triple') ?? getSpec(specs, 'Main Camera', 'Dual') ?? getSpec(specs, 'Main Camera', 'Single');
  const selfieCamera =
    getSpec(specs, 'Selfie camera', 'Single') ??
    getSpec(specs, 'Selfie camera', 'Dual') ??
    getSpec(specs, 'Selfie camera', 'Triple');
  const sensors = getSpec(specs, 'Features', 'Sensors');
  const featuresExtra = getSpec(specs, 'Features', 'Sensors')
    ? specs.Features?.Sensors
    : undefined;
  const batteryType = getSpec(specs, 'Battery', 'Type');
  const charging = getSpec(specs, 'Battery', 'Charging');
  const build = getSpec(specs, 'Body', 'Build');
  const sim = getSpec(specs, 'Body', 'SIM');
  const comment = getSpec(specs, 'Meta', 'Comment');
  const announced = getSpec(specs, 'Launch', 'Announced');
  const status = getSpec(specs, 'Launch', 'Status');
  const colors = getSpec(specs, 'Misc', 'Colors');
  const fiveGBands = getSpec(specs, 'Network', '5G bands');

  const storageOptionsGb = uniqueNumbers((memoryInternal ?? '').split(',').map(parseStorageGb));
  const ramOptionsGb = uniqueNumbers(
    [...(memoryInternal?.matchAll(/(\d+(?:\.\d+)?)\s*GB RAM/gi) ?? [])].map((match) => Number(match[1])),
  );
  const brightnessMatches = [...(displayType?.matchAll(/(\d+)\s*nits/gi) ?? [])].map((match) => Number(match[1]));

  const releaseYear = parseReleaseYear(announced);
  const specsOut: PhoneTechnicalSpecs = {
    dimensions: {
      heightMm: parseFloatValue(getSpec(specs, 'Body', 'Dimensions'), /([\d.]+)\s*x/i),
      widthMm: parseFloatValue(getSpec(specs, 'Body', 'Dimensions'), /[\d.]+\s*x\s*([\d.]+)/i),
      depthMm: parseFloatValue(getSpec(specs, 'Body', 'Dimensions'), /[\d.]+\s*x\s*[\d.]+\s*x\s*([\d.]+)/i),
      weightG: parseFloatValue(getSpec(specs, 'Body', 'Weight'), /([\d.]+)\s*g/i),
    },
    display: {
      diagonalInch: parseFloatValue(displaySize, /([\d.]+)\s*inches/i),
      resolutionPx: parseResolution(displayResolution),
      resolutionLabel: displayResolution?.split('(')[0]?.trim(),
      aspectRatio: parseAspectRatio(displayResolution),
      panelType: displayType?.split(',').slice(0, 2).join(', ').trim(),
      refreshRateHz: parseFloatValue(displayType, /(\d+)\s*Hz/i),
      peakBrightnessNits: maxNumber(brightnessMatches),
      hdr: [...new Set((displayType?.match(/HDR10\+?|Dolby Vision/gi) ?? []).map((item) => item.trim()))],
      protection: getSpec(specs, 'Display', 'Protection') ? [getSpec(specs, 'Display', 'Protection') as string] : [],
      alwaysOn: /always[- ]on/i.test(`${displayType ?? ''} ${getSpec(specs, 'Display', 'Features') ?? ''}`),
    },
    performance: {
      chipset: getSpec(specs, 'Platform', 'Chipset'),
      cpu: getSpec(specs, 'Platform', 'CPU'),
      gpu: getSpec(specs, 'Platform', 'GPU'),
      ramGb: maxNumber(ramOptionsGb),
      storageOptionsGb,
      storageType: memoryExtra && !/^no$/i.test(memoryExtra) ? memoryExtra : getSpec(specs, 'Memory', 'Internal')?.includes('NVMe') ? 'NVMe' : undefined,
      simSlots: /dual/i.test(sim ?? '') || /max 2 at a time/i.test(sim ?? '') ? 2 : sim ? 1 : undefined,
      esim: /esim/i.test(sim ?? ''),
      usb: getSpec(specs, 'Comms', 'USB'),
      wifi: getSpec(specs, 'Comms', 'WLAN'),
      bluetooth: getSpec(specs, 'Comms', 'Bluetooth'),
      nfc: /^yes$/i.test(getSpec(specs, 'Comms', 'NFC') ?? ''),
      uwb: /ultra wideband|uwb/i.test(featuresExtra ?? ''),
      satellite: /satellite/i.test(featuresExtra ?? '') ? featuresExtra : undefined,
    },
    cameras: {
      rear: parseCameraModules(mainCamera),
      front: parseFrontCamera(selfieCamera),
      video: parseVideoSummary(getSpec(specs, 'Main Camera', 'Video')),
    },
    audio: {
      stereoSpeakers: /stereo/i.test(getSpec(specs, 'Sound', 'Loudspeaker') ?? ''),
      headphoneJack: /^yes$/i.test(getSpec(specs, 'Sound', '3.5mm jack') ?? ''),
    },
    battery: {
      capacityMah: parseFloatValue(batteryType, /(\d+)\s*mAh/i),
      wiredChargeW: parseFloatValue(charging, /(\d+(?:\.\d+)?)W wired/i),
      wirelessChargeW: maxNumber([parseFloatValue(charging, /(\d+(?:\.\d+)?)W wireless/i)]),
      reverseWireless: /reverse wireless/i.test(charging ?? ''),
    },
    software: {
      os: platformOs?.split(/\s+/)[0],
      osVersionAtLaunch: platformOs?.split(',')[0]?.trim(),
    },
    network: {
      cellular: getSpec(specs, 'Network', 'Technology'),
      fiveG: /\b5G\b/i.test(getSpec(specs, 'Network', 'Technology') ?? ''),
      fiveGBandsNote: fiveGBands,
    },
    build: {
      frameMaterial: parseBuildMaterial(build, 'frame'),
      backMaterial: parseBuildMaterial(build, 'back'),
      ipRating: `${getSpec(specs, 'Body', 'SIM') ?? ''} ${comment ?? ''} ${status ?? ''}`.match(/IP\d{2}/i)?.[0],
      colors: colors?.split(',').map((item) => item.trim()).filter(Boolean) ?? [],
    },
    biometrics: {
      face: /face id|face unlock|3d face/i.test(sensors ?? ''),
      fingerprint: parseFingerprint(sensors),
    },
    extras: {
      releaseYear: releaseYear ?? undefined,
      gsmarena: {
        matchedName: matched.title,
        matchedUrl: matched.url,
        searchQuery: matched.query,
        comment,
        announced,
        models: getSpec(specs, 'Misc', 'Models'),
      },
    },
  };

  return {
    matched,
    marketingName: title,
    releaseYear,
    specs: specsOut,
  };
}

export async function fetchAndParseGsmarenaSpecs(model: PhoneModelForMatch): Promise<GsmarenaParsedSpec | null> {
  const matched = await findBestGsmarenaMatch(model);
  if (!matched) return null;
  const html = await fetchText(matched.url);
  return parseGsmarenaSpecPage(html, matched);
}
