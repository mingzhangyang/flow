// Visual System v2: semantic presentation tokens only.
// Flow / Node / Run never store color. Runner remains an immersive scene independent of system appearance.

export interface FlowIdentityTone {
  accent: string;
  soft: string;
}

export interface Palette {
  // Foundations
  canvas: string;
  surface: string;
  surfaceRaised: string;
  surfaceSubtle: string;

  // Boundaries
  border: string;

  // Text
  text: string;
  textMuted: string;
  textFaint: string;

  // Brand / actions
  primary: string;
  onPrimary: string;
  primarySoft: string;
  onPrimarySoft: string;

  // Supporting accents
  secondary: string;
  secondarySoft: string;

  // Semantic states
  success: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;

  // Controls
  inputSurface: string;

  // UI projection only: stable flow identity colors, never serialized.
  flowAccents: readonly FlowIdentityTone[];
}

/** Light: airy warm-neutral canvas, fresh botanical primary, restrained supporting color. */
export const light: Palette = {
  canvas: '#F7FAF7',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSubtle: '#F0F5F1',
  border: '#DCE6DF',

  text: '#17231C',
  textMuted: '#58685E',
  textFaint: '#819087',

  primary: '#18794E',
  onPrimary: '#FFFFFF',
  primarySoft: '#E4F4EA',
  onPrimarySoft: '#155C3B',

  secondary: '#3E78BC',
  secondarySoft: '#EAF2FC',

  success: '#2F7A50',
  warning: '#9A650F',
  warningSoft: '#FFF3D8',
  danger: '#B64B45',
  dangerSoft: '#FCEBE9',

  inputSurface: '#F4F7F4',

  flowAccents: [
    { accent: '#27885A', soft: '#EAF7EF' },
    { accent: '#4A80BF', soft: '#EDF4FC' },
    { accent: '#7768BE', soft: '#F2EFFB' },
    { accent: '#C46C5A', soft: '#FCEEEA' },
    { accent: '#B47A20', soft: '#FBF3E1' },
    { accent: '#2F8B86', soft: '#E9F6F4' },
  ],
};

/** Dark: green-black rather than pure black, with readable layered surfaces and quiet chroma. */
export const darkScheme: Palette = {
  canvas: '#101814',
  surface: '#17221D',
  surfaceRaised: '#1C2923',
  surfaceSubtle: '#18251F',
  border: '#2A3B32',

  text: '#F0F5F1',
  textMuted: '#A5B3AA',
  textFaint: '#74847A',

  primary: '#76D3A0',
  onPrimary: '#10271B',
  primarySoft: '#1C3B2B',
  onPrimarySoft: '#B8EFCB',

  secondary: '#82AFE8',
  secondarySoft: '#1B2E43',

  success: '#72CA94',
  warning: '#E0B35E',
  warningSoft: '#3A2F1B',
  danger: '#EB8B82',
  dangerSoft: '#402523',

  inputSurface: '#18241E',

  flowAccents: [
    { accent: '#79D6A4', soft: '#173126' },
    { accent: '#84B2EA', soft: '#1A2D40' },
    { accent: '#AA9BE7', soft: '#292641' },
    { accent: '#E99A89', soft: '#3B2724' },
    { accent: '#E0B769', soft: '#372F1E' },
    { accent: '#73CBC4', soft: '#183431' },
  ],
};

/** System appearance -> app palette. */
export function paletteFor(scheme: string | null | undefined): Palette {
  return scheme === 'dark' ? darkScheme : light;
}

/** Stable UI-only flow identity derived from id. */
export function flowIdentityFor(palette: Palette, id: string): FlowIdentityTone {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette.flowAccents[h % palette.flowAccents.length]!;
}

/**
 * Runner immersive scene: a focused, deep botanical environment that deliberately does not
 * follow the system light/dark switch.
 */
export const dark = {
  bg: '#0D241A',
  surface: '#143326',
  surfaceRaised: '#193C2D',
  border: '#28513F',
  text: '#F4F8F5',
  textMuted: '#A4B9AC',
  faint: '#3A6752',
  accent: '#74D7A4',
  accentSoft: '#1C4933',
  warm: '#F0B16B',
  danger: '#EF8C7F',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

export const type = { caption: 12, body: 15, emphasis: 17, title: 22, display: 34, clock: 64 } as const;

export const mono = { thin: 'IBMPlexMono_200ExtraLight', medium: 'IBMPlexMono_500Medium' } as const;
