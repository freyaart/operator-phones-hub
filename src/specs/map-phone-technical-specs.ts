import type { Prisma } from '@prisma/client';
import type { PhoneTechnicalSpecs } from './phone-technical-specs.js';

type RearCamera = NonNullable<NonNullable<PhoneTechnicalSpecs['cameras']>['rear']>[number];

function joinCameraSummary(items: RearCamera[] | undefined): string | undefined {
  if (!items || items.length === 0) return undefined;
  return items
    .map((item: RearCamera) => {
      const bits = [item.role, item.mp != null ? `${item.mp} MP` : null, item.aperture, item.ois ? 'OIS' : null].filter(Boolean);
      return bits.join(' ');
    })
    .join(' | ');
}

export function mapPhoneTechnicalSpecsToPhoneSpec(
  specs: PhoneTechnicalSpecs | undefined,
): Omit<Prisma.PhoneSpecUncheckedCreateInput, 'phoneModelId'> {
  const rearCameraSummary = joinCameraSummary(specs?.cameras?.rear);
  const frontCameraSummary = specs?.cameras?.front
    ? [
        specs.cameras.front.mp != null ? `${specs.cameras.front.mp} MP` : null,
        specs.cameras.front.aperture,
        specs.cameras.front.autofocus ? 'AF' : null,
      ]
        .filter(Boolean)
        .join(' ')
    : undefined;
  const videoSummary = specs?.cameras?.video
    ? [
        specs.cameras.video.maxResolutionLabel,
        specs.cameras.video.maxFps != null ? `${specs.cameras.video.maxFps} fps` : null,
        specs.cameras.video.hdrModes?.length ? specs.cameras.video.hdrModes.join(', ') : null,
      ]
        .filter(Boolean)
        .join(' | ')
    : undefined;

  return {
    market: specs?.market,
    releaseYear: specs?.extras?.releaseYear as number | undefined,
    heightMm: specs?.dimensions?.heightMm,
    widthMm: specs?.dimensions?.widthMm,
    depthMm: specs?.dimensions?.depthMm,
    weightG: specs?.dimensions?.weightG,
    displayDiagonalInch: specs?.display?.diagonalInch,
    displayWidthPx: specs?.display?.resolutionPx?.width,
    displayHeightPx: specs?.display?.resolutionPx?.height,
    displayResolutionLabel: specs?.display?.resolutionLabel,
    displayAspectRatio: specs?.display?.aspectRatio,
    displayPanelType: specs?.display?.panelType,
    displayRefreshRateHz: specs?.display?.refreshRateHz,
    displayTouchSamplingHz: specs?.display?.touchSamplingHz,
    displayPeakBrightnessNits: specs?.display?.peakBrightnessNits,
    displayHdr: specs?.display?.hdr ?? [],
    displayProtection: specs?.display?.protection ?? [],
    displayAlwaysOn: specs?.display?.alwaysOn,
    chipset: specs?.performance?.chipset,
    cpu: specs?.performance?.cpu,
    gpu: specs?.performance?.gpu,
    ramGb: specs?.performance?.ramGb,
    storageOptionsGb: specs?.performance?.storageOptionsGb ?? [],
    storageType: specs?.performance?.storageType,
    simSlots: specs?.performance?.simSlots,
    esim: specs?.performance?.esim,
    usb: specs?.performance?.usb,
    wifi: specs?.performance?.wifi,
    bluetooth: specs?.performance?.bluetooth,
    nfc: specs?.performance?.nfc,
    uwb: specs?.performance?.uwb,
    satellite: specs?.performance?.satellite,
    rearCameraSummary,
    frontCameraSummary,
    videoSummary,
    stereoSpeakers: specs?.audio?.stereoSpeakers,
    headphoneJack: specs?.audio?.headphoneJack,
    batteryCapacityMah: specs?.battery?.capacityMah,
    wiredChargeW: specs?.battery?.wiredChargeW,
    wirelessChargeW: specs?.battery?.wirelessChargeW,
    reverseWireless: specs?.battery?.reverseWireless,
    os: specs?.software?.os,
    osVersionAtLaunch: specs?.software?.osVersionAtLaunch,
    updatePolicyYears: specs?.software?.updatePolicyYears,
    cellular: specs?.network?.cellular,
    fiveG: specs?.network?.fiveG,
    fiveGBandsNote: specs?.network?.fiveGBandsNote,
    frameMaterial: specs?.build?.frameMaterial,
    backMaterial: specs?.build?.backMaterial,
    ipRating: specs?.build?.ipRating,
    colors: specs?.build?.colors ?? [],
    faceBiometrics: specs?.biometrics?.face,
    fingerprint: specs?.biometrics?.fingerprint,
    extras: specs?.extras === undefined ? undefined : (specs.extras as Prisma.InputJsonValue),
  };
}
