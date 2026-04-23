export type FlatScalar = string | number | boolean | null;

function join(values: Array<string | number | null | undefined>): string | null {
  const out = values.filter((v): v is string | number => v !== null && v !== undefined && v !== '');
  return out.length > 0 ? out.join(' | ') : null;
}

function arrayToCell(values: unknown): FlatScalar {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.map(String).join('; ');
}

export function rowForComparison(phone: {
  id: string;
  slug: string;
  brand: string;
  series: string;
  marketingName?: string | null;
  releaseYear?: number | null;
  phoneSpec?: {
    market: string | null;
    releaseYear: number | null;
    heightMm: number | null;
    widthMm: number | null;
    depthMm: number | null;
    weightG: number | null;
    displayDiagonalInch: number | null;
    displayWidthPx: number | null;
    displayHeightPx: number | null;
    displayResolutionLabel: string | null;
    displayAspectRatio: string | null;
    displayPanelType: string | null;
    displayRefreshRateHz: number | null;
    displayTouchSamplingHz: number | null;
    displayPeakBrightnessNits: number | null;
    displayHdr: string[];
    displayProtection: string[];
    displayAlwaysOn: boolean | null;
    chipset: string | null;
    cpu: string | null;
    gpu: string | null;
    ramGb: number | null;
    storageOptionsGb: number[];
    storageType: string | null;
    simSlots: number | null;
    esim: boolean | null;
    usb: string | null;
    wifi: string | null;
    bluetooth: string | null;
    nfc: boolean | null;
    uwb: boolean | null;
    satellite: string | null;
    rearCameraSummary: string | null;
    frontCameraSummary: string | null;
    videoSummary: string | null;
    stereoSpeakers: boolean | null;
    headphoneJack: boolean | null;
    batteryCapacityMah: number | null;
    wiredChargeW: number | null;
    wirelessChargeW: number | null;
    reverseWireless: boolean | null;
    os: string | null;
    osVersionAtLaunch: string | null;
    updatePolicyYears: number | null;
    cellular: string | null;
    fiveG: boolean | null;
    fiveGBandsNote: string | null;
    frameMaterial: string | null;
    backMaterial: string | null;
    ipRating: string | null;
    colors: string[];
    faceBiometrics: boolean | null;
    fingerprint: string | null;
  } | null;
  specs?: unknown;
}): Record<string, FlatScalar> {
  const spec = phone.phoneSpec;
  return {
    id: phone.id,
    slug: phone.slug,
    brand: phone.brand,
    series: phone.series,
    marketingName: phone.marketingName ?? null,
    releaseYear: spec?.releaseYear ?? phone.releaseYear ?? null,
    market: spec?.market ?? null,
    display: join([
      spec?.displayDiagonalInch != null ? `${spec.displayDiagonalInch}"` : null,
      spec?.displayResolutionLabel,
      spec?.displayWidthPx != null && spec?.displayHeightPx != null ? `${spec.displayWidthPx}x${spec.displayHeightPx}` : null,
      spec?.displayPanelType,
      spec?.displayRefreshRateHz != null ? `${spec.displayRefreshRateHz} Hz` : null,
    ]),
    displayHdr: arrayToCell(spec?.displayHdr),
    displayProtection: arrayToCell(spec?.displayProtection),
    chipset: spec?.chipset ?? null,
    cpu: spec?.cpu ?? null,
    gpu: spec?.gpu ?? null,
    ramGb: spec?.ramGb ?? null,
    storageOptionsGb: arrayToCell(spec?.storageOptionsGb),
    storageType: spec?.storageType ?? null,
    sim: join([spec?.simSlots != null ? `${spec.simSlots} SIM` : null, spec?.esim ? 'eSIM' : null]),
    connectivity: join([spec?.usb, spec?.wifi, spec?.bluetooth, spec?.nfc ? 'NFC' : null, spec?.uwb ? 'UWB' : null]),
    rearCamera: spec?.rearCameraSummary ?? null,
    frontCamera: spec?.frontCameraSummary ?? null,
    video: spec?.videoSummary ?? null,
    battery: join([
      spec?.batteryCapacityMah != null ? `${spec.batteryCapacityMah} mAh` : null,
      spec?.wiredChargeW != null ? `${spec.wiredChargeW}W wired` : null,
      spec?.wirelessChargeW != null ? `${spec.wirelessChargeW}W wireless` : null,
    ]),
    audio: join([spec?.stereoSpeakers ? 'Stereo speakers' : null, spec?.headphoneJack ? '3.5mm jack' : null]),
    software: join([spec?.os, spec?.osVersionAtLaunch, spec?.updatePolicyYears != null ? `${spec.updatePolicyYears} years updates` : null]),
    network: join([spec?.cellular, spec?.fiveG ? '5G' : null, spec?.fiveGBandsNote]),
    build: join([spec?.frameMaterial, spec?.backMaterial, spec?.ipRating]),
    colors: arrayToCell(spec?.colors),
    biometrics: join([spec?.faceBiometrics ? 'Face' : null, spec?.fingerprint]),
    dimensions: join([
      spec?.heightMm != null && spec?.widthMm != null && spec?.depthMm != null
        ? `${spec.heightMm} x ${spec.widthMm} x ${spec.depthMm} mm`
        : null,
      spec?.weightG != null ? `${spec.weightG} g` : null,
    ]),
  };
}

export function unionSortedColumns(rows: Record<string, FlatScalar>[]): string[] {
  const all = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) all.add(key);
  }
  return [...all].sort((a, b) => a.localeCompare(b));
}
