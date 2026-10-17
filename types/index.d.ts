export type PartnerLevel = 'beginner' | 'intermediate' | 'advanced'

export type PartnerSettings = {
  isGrammarOn: boolean
  /** The language being learned; null translates nothing. */
  target: string | null
  level: PartnerLevel
}

export type PartnerFix = { from: string; to: string; why: string }

export type PartnerWord = {
  word: string
  /** How the word sounds, in Latin letters; only for a language written in another script. */
  pronunciation?: string
  meaning: string
  example?: string
}

/** One typed prompt and what the tutor model made of it. */
export type PartnerCheck = {
  id: string
  text: string
  status: 'checking' | 'done' | 'failed'
  language?: string
  /** Present when grammar was checked. */
  corrected?: string
  fixes: PartnerFix[]
  target?: string
  translation?: string
  /** The translation as it sounds, in Latin letters; only for a language written in another script. */
  pronunciation?: string
  words: PartnerWord[]
  error?: string
}

/** A flashcard; `box` 0-4 is how well it is known. */
export type PartnerCard = PartnerWord & {
  id: string
  language: string
  box: number
  seenAt: number
}

export type PartnerTab = 'latest' | 'practice'

export type PartnerPractice = { cardId: string | null; isRevealed: boolean }

declare module 'claude-code' {
  interface PluginState {
    'language-partner': {
      settings: PartnerSettings
      latest: PartnerCheck | null
      deck: PartnerCard[]
      isBandHidden: boolean
      tab: PartnerTab
      practice: PartnerPractice
    }
  }
}
