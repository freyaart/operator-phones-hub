/**
 * Recommended shape for `PhoneModel.specs` (stored as JSON).
 * All fields optional — different brands expose different data; unknowns go in `extras`.
 */
export type PhoneTechnicalSpecs = {
  /** ISO region / channel this row describes */
  market?: string;

  dimensions?: {
    heightMm?: number;
    widthMm?: number;
    depthMm?: number;
    weightG?: number;
  };

  display?: {
    diagonalInch?: number;
    resolutionPx?: { width?: number; height?: number };
    resolutionLabel?: string;
    aspectRatio?: string;
    panelType?: string;
    refreshRateHz?: number;
    touchSamplingHz?: number;
    peakBrightnessNits?: number;
    hdr?: string[];
    protection?: string[];
    alwaysOn?: boolean;
  };

  performance?: {
    chipset?: string;
    /** CPU micro-architecture / marketing name */
    cpu?: string;
    gpu?: string;
    ramGb?: number;
    storageType?: string;
    /** eSIM + physical count, etc. */
    simSlots?: number;
    esim?: boolean;
    /** USB version, e.g. "USB-C 3.2 Gen 2" */
    usb?: string;
    /** Wi‑Fi generation / Bluetooth version strings */
    wifi?: string;
    bluetooth?: string;
    nfc?: boolean;
    uwb?: boolean;
    /** Satellite / emergency features */
    satellite?: string;
  };

  cameras?: {
    rear?: Array<{
      role?: string;
      mp?: number;
      aperture?: string;
      sensorSizeInch?: string;
      ois?: boolean;
      focalLengthMmEq?: number;
    }>;
    front?: {
      mp?: number;
      aperture?: string;
      autofocus?: boolean;
    };
    video?: {
      maxResolutionLabel?: string;
      maxFps?: number;
      hdrModes?: string[];
    };
  };

  audio?: {
    stereoSpeakers?: boolean;
    /** 3.5 mm jack */
    headphoneJack?: boolean;
  };

  battery?: {
    capacityMah?: number;
    /** Wired peak W */
    wiredChargeW?: number;
    wirelessChargeW?: number;
    reverseWireless?: boolean;
  };

  software?: {
    os?: string;
    osVersionAtLaunch?: string;
    /** Years of promised updates, if known */
    updatePolicyYears?: number;
  };

  network?: {
    cellular?: string;
    fiveG?: boolean;
    /** Sub-6 / mmWave notes */
    fiveGBandsNote?: string;
  };

  build?: {
    frameMaterial?: string;
    backMaterial?: string;
    ipRating?: string;
    /** Official color names */
    colors?: string[];
  };

  biometrics?: {
    face?: boolean;
    fingerprint?: string;
    /** Under-display, side, etc. */
  };

  /** Anything that does not fit the groups above */
  extras?: Record<string, unknown>;
};
