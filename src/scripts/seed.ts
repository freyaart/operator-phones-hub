/**
 * Minimal canonical catalog seed. Extend `data/phones.json` as needed.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PhoneTechnicalSpecs } from '../specs/phone-technical-specs.js';
import { prisma } from '../db.js';
import { upsertPhoneModelWithSpec } from '../models/upsert-phone-model.js';

type SeedPhone = {
  brand: string;
  series: string;
  storageGb: number | null;
  slug: string;
  specs?: PhoneTechnicalSpecs;
  details?: Record<string, unknown>;
};

const defaultPhones: SeedPhone[] = [
  {
    brand: 'Apple',
    series: 'iPhone 15 Pro',
    storageGb: null,
    slug: 'apple-iphone-15-pro',
    details: { importSource: 'seed' },
    specs: {
      market: 'SI',
      dimensions: { heightMm: 146.6, widthMm: 70.6, depthMm: 8.25, weightG: 187 },
      display: {
        diagonalInch: 6.1,
        resolutionPx: { width: 2556, height: 1179 },
        panelType: 'LTPO OLED',
        refreshRateHz: 120,
        peakBrightnessNits: 2000,
        hdr: ['HDR10', 'Dolby Vision'],
        protection: ['Ceramic Shield'],
        alwaysOn: true,
      },
      performance: {
        chipset: 'Apple A17 Pro',
        ramGb: 8,
        storageType: 'NVMe',
        esim: true,
        simSlots: 1,
        usb: 'USB-C (USB 3)',
        wifi: 'Wi‑Fi 6E',
        bluetooth: '5.3',
        nfc: true,
        uwb: true,
      },
      cameras: {
        rear: [
          { role: 'wide', mp: 48, aperture: 'f/1.78', ois: true },
          { role: 'ultrawide', mp: 12, aperture: 'f/2.2' },
          { role: 'tele 3x', mp: 12, aperture: 'f/2.8', ois: true },
        ],
        front: { mp: 12, aperture: 'f/1.9', autofocus: true },
        video: { maxResolutionLabel: '4K', maxFps: 60, hdrModes: ['Dolby Vision'] },
      },
      battery: { wiredChargeW: 20, wirelessChargeW: 15, reverseWireless: true },
      software: { os: 'iOS', osVersionAtLaunch: '17' },
      network: { cellular: '5G (sub‑6)', fiveG: true },
      build: { frameMaterial: 'Titanium', backMaterial: 'Textured matte glass', ipRating: 'IP68', colors: ['Natural Titanium', 'Blue Titanium'] },
      biometrics: { face: true },
    },
  },
  {
    brand: 'Apple',
    series: 'iPhone 15',
    storageGb: null,
    slug: 'apple-iphone-15',
    details: { importSource: 'seed' },
    specs: {
      market: 'SI',
      dimensions: { heightMm: 147.6, widthMm: 71.6, depthMm: 7.8, weightG: 171 },
      display: {
        diagonalInch: 6.1,
        resolutionPx: { width: 2556, height: 1179 },
        panelType: 'OLED',
        refreshRateHz: 60,
        peakBrightnessNits: 2000,
        hdr: ['HDR10', 'Dolby Vision'],
        protection: ['Ceramic Shield'],
      },
      performance: {
        chipset: 'Apple A16 Bionic',
        ramGb: 6,
        storageType: 'NVMe',
        esim: true,
        simSlots: 1,
        usb: 'USB-C (USB 2)',
        wifi: 'Wi‑Fi 6',
        bluetooth: '5.3',
        nfc: true,
      },
      cameras: {
        rear: [
          { role: 'wide', mp: 48, aperture: 'f/1.6', ois: true },
          { role: 'ultrawide', mp: 12, aperture: 'f/2.4' },
        ],
        front: { mp: 12, aperture: 'f/1.9', autofocus: true },
      },
      battery: { wiredChargeW: 20, wirelessChargeW: 15, reverseWireless: true },
      software: { os: 'iOS', osVersionAtLaunch: '17' },
      network: { fiveG: true },
      build: { frameMaterial: 'Aluminum', backMaterial: 'Color‑infused glass', ipRating: 'IP68' },
      biometrics: { face: true },
    },
  },
];

async function loadPhonesFromJson(): Promise<SeedPhone[]> {
  try {
    const raw = await readFile(resolve(process.cwd(), 'data', 'phones.json'), 'utf8');
    const parsed = JSON.parse(raw) as { phones?: SeedPhone[] };
    if (Array.isArray(parsed.phones) && parsed.phones.length > 0) return parsed.phones;
  } catch {
    /* optional file */
  }
  return defaultPhones;
}

async function main() {
  const phones = await loadPhonesFromJson();
  for (const p of phones) {
    await upsertPhoneModelWithSpec({
      brand: p.brand,
      series: p.series,
      slug: p.slug,
      marketingName: p.series,
      source: 'seed',
      specs: p.specs,
      details: p.details as never,
    });
    console.log('Upserted', p.slug);
  }
  console.log('Done. Run: npm run sync');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
