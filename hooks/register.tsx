import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PartnerCard, PartnerCheck, PartnerSettings, PartnerTab } from '../types'
import {
  addWords,
  DEFAULT_SETTINGS,
  grade,
  isLevel,
  isWorthChecking,
  languageName,
  LEVELS,
  nextCard,
  normalizeDeck,
  normalizeSettings,
  parseReply,
  systemPrompt,
} from './coach'

const PANE = 'language-partner'
const TITLE = 'Language partner'
const MODEL = 'haiku'

const settings = atom({ plugin: 'language-partner', key: 'settings' } as const, DEFAULT_SETTINGS)
const latest = atom({ plugin: 'language-partner', key: 'latest' } as const, null)
const deck = atom({ plugin: 'language-partner', key: 'deck' } as const, [])
const isBandHidden = atom({ plugin: 'language-partner', key: 'isBandHidden' } as const, false)
const tab = atom({ plugin: 'language-partner', key: 'tab' } as const, 'latest')
const practice = atom({ plugin: 'language-partner', key: 'practice' } as const, {
  cardId: null,
  isRevealed: false,
})

async function saveSettings($: EngineInterface, change: (now: PartnerSettings) => PartnerSettings): Promise<PartnerSettings> {
  const saved = await update($, settings, change)
  await $.store.set('settings', saved)

  return saved
}

async function saveDeck($: EngineInterface, change: (cards: PartnerCard[]) => PartnerCard[]): Promise<void> {
  await $.store.set('deck', await update($, deck, change))
}

/** Asks the tutor model about one typed prompt; runs off a timer so the prompt never waits for it. */
async function check($: EngineInterface, id: string, text: string, asked: PartnerSettings): Promise<void> {
  const failed = (error: string): PartnerCheck => ({ id, text, status: 'failed', fixes: [], words: [], error })
  let found: PartnerCheck
  try {
    const reply = await $.model.complete({
      model: MODEL,
      system: systemPrompt(asked),
      prompt: `<message>\n${text}\n</message>`,
      maxTokens: 1500,
      timeoutMs: 30_000,
    })
    const parsed = reply.isAnswered ? parseReply(reply.text) : undefined
    found =
      parsed === undefined
        ? failed(reply.isAnswered ? 'the reply was not JSON' : reply.reason)
        : { id, text, status: 'done', ...parsed, ...(asked.target === null ? {} : { target: asked.target }) }
  } catch (error) {
    found = failed(error instanceof Error ? error.message : String(error))
  }

  await update($, latest, current => (current?.id === id ? found : current))

  const { words } = found
  if (asked.target !== null && words.length > 0) {
    const at = await $.clock.now()
    const language = asked.target
    await saveDeck($, cards => addWords(cards, words, language, at))
  }
}

async function pickCard($: EngineInterface, skip?: string): Promise<void> {
  const card = nextCard(await read($, deck), (await read($, settings)).target, skip)
  await update($, practice, () => ({ cardId: card?.id ?? null, isRevealed: false }))
}

async function answer($: EngineInterface, id: string, isKnown: boolean): Promise<void> {
  const at = await $.clock.now()
  await saveDeck($, cards => grade(cards, id, isKnown, at))
  await pickCard($, id)
}

async function show($: EngineInterface, view: PartnerTab): Promise<void> {
  await update($, tab, () => view)
  if (view === 'practice') await pickCard($)
  await $.ui.open({ id: PANE, title: TITLE, ...(view === 'practice' ? { focus: true as const } : {}) })
}

async function status($: EngineInterface): Promise<string> {
  const now = await read($, settings)
  const words = (await read($, deck)).filter(card => card.language === now.target).length
  const learning =
    now.target === null
      ? 'Not learning a language yet: /lang <language> picks one.'
      : `Learning ${now.target} (${now.level}), ${words} word${words === 1 ? '' : 's'} to practice: /lang practice.`

  return `${learning} Grammar checks are ${now.isGrammarOn ? 'on' : 'off'}.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lang',
      description: 'Language partner: pick the language you are learning, practice its words, or open the pane',
      argumentHint: '[language | off | level <beginner|intermediate|advanced> | practice]',
    })
    await $.command.register({
      name: 'grammar',
      description: 'Language partner: turn the grammar checks of your prompts on or off',
      argumentHint: '[on | off]',
    })
    const stored = normalizeSettings(await $.store.get('settings'))
    const cards = normalizeDeck(await $.store.get('deck'))
    await update($, settings, () => stored)
    await update($, deck, () => cards)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const asked = await read($, settings)
    const isTyped = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const isWanted = asked.isGrammarOn || asked.target !== null

    if (isTyped && isWanted && e.command === undefined && !e.isMeta && isWorthChecking(e.text)) {
      const id = String(await $.clock.now())
      const text = e.text
      await update($, latest, (): PartnerCheck => ({ id, text, status: 'checking', fixes: [], words: [] }))
      await update($, isBandHidden, () => false)
      $.clock.after(0, () => void check($, id, text, asked))
    }

    return next(e)
  })

  on('command.run', { command: 'lang' }, async ($, e) => {
    const [head = '', second] = e.args.trim().split(/\s+/)
    const word = head.toLowerCase()

    if (word === '') {
      await show($, 'latest')

      return { text: await status($) }
    }
    if (word === 'off') {
      await saveSettings($, now => ({ ...now, target: null }))

      return { text: 'Stopped translating your prompts. Your saved words stay for when you pick a language again.' }
    }
    if (word === 'level') {
      const level = second?.toLowerCase()
      if (!isLevel(level)) return { text: `Pick a level: ${LEVELS.join(', ')}.` }
      await saveSettings($, now => ({ ...now, level }))

      return { text: `Words will be picked for a ${level} learner.` }
    }
    if (word === 'practice') {
      const target = (await read($, settings)).target
      await show($, 'practice')

      return { text: `Practicing ${target ?? 'all your'} words in the ${TITLE} pane.` }
    }

    const target = languageName(e.args)
    if (target === undefined) return { text: `"${e.args.trim()}" is not a language name. Try /lang Spanish.` }
    await saveSettings($, now => ({ ...now, target }))

    return {
      text: `Now learning ${target}. Each prompt you type is translated into ${target} above the prompt, and its useful words are saved for /lang practice.`,
    }
  })

  on('command.run', { command: 'grammar' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word !== 'on' && word !== 'off') return { text: `${await status($)} /grammar on or /grammar off to change.` }
    await saveSettings($, now => ({ ...now, isGrammarOn: word === 'on' }))

    return { text: `Grammar checks ${word}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, latest)
    if (e.props.hasSurvey || shown === null || (await read($, isBandHidden))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = []

    if (shown.status === 'checking') rows.push(<Text dimColor>Checking your prompt…</Text>)
    if (shown.status === 'failed') rows.push(<Text dimColor>The language check failed: {shown.error}</Text>)
    if (shown.status === 'done' && shown.corrected !== undefined) {
      const more = shown.fixes.length - 2
      rows.push(
        shown.fixes.length === 0 ? (
          <Text color="success">✓ No grammar mistakes</Text>
        ) : (
          <Text wrap="truncate-end">
            <Text color="warning">✎ </Text>
            {shown.fixes.slice(0, 2).map((fix, i) => (
              <Text>
                {i > 0 ? '; ' : ''}
                <Text color="error" strikethrough>
                  {fix.from}
                </Text>
                {' → '}
                <Text color="success">{fix.to}</Text>
              </Text>
            ))}
            {more > 0 ? <Text dimColor> +{more} more</Text> : ''}
          </Text>
        ),
      )
    }
    if (shown.status === 'done' && shown.translation !== undefined) {
      rows.push(
        <Text wrap="truncate-end">
          <Text dimColor>{shown.target}: </Text>
          {shown.translation}
        </Text>,
      )
    }

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box justifyContent="space-between" gap={1}>
          <Box flexShrink={1}>{rows[0]}</Box>
          <Box gap={1} flexShrink={0}>
            <Button key="details" label="Details" onPress={() => show($, 'latest')} />
            <Button key="hide" label="Hide" onPress={() => update($, isBandHidden, () => true)} />
          </Box>
        </Box>
        {rows.slice(1)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const view = await read($, tab)
    const now = await read($, settings)

    const tabs = (
      <Box gap={1}>
        <Button
          key="tab-latest"
          label="Latest prompt"
          hotkey="l"
          variant={view === 'latest' ? 'primary' : 'secondary'}
          onPress={() => show($, 'latest')}
        />
        <Button
          key="tab-practice"
          label="Practice"
          hotkey="p"
          variant={view === 'practice' ? 'primary' : 'secondary'}
          onPress={() => show($, 'practice')}
        />
      </Box>
    )

    if (view === 'practice') {
      const cards = await read($, deck)
      const pool = cards.filter(card => now.target === null || card.language === now.target)
      const { cardId, isRevealed } = await read($, practice)
      const card = cards.find(one => one.id === cardId)

      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          {card === undefined ? (
            <Text dimColor>
              {now.target === null
                ? 'Pick a language first, with /lang Spanish for one.'
                : `No ${now.target} words yet: they are saved from the prompts you type.`}
            </Text>
          ) : (
            <Box flexDirection="column" gap={1}>
              <Text dimColor>
                {card.language} · {pool.length} word{pool.length === 1 ? '' : 's'} · known {card.box}/4
              </Text>
              <Text bold>{card.word}</Text>
              {isRevealed ? (
                <Box flexDirection="column">
                  <Text>{card.meaning}</Text>
                  {card.example === undefined ? null : <Text dimColor>{card.example}</Text>}
                </Box>
              ) : null}
              {isRevealed ? (
                <Box gap={1}>
                  <Button key="again" label="Again" hotkey="a" onPress={() => answer($, card.id, false)} />
                  <Button key="known" label="Got it" hotkey="g" variant="primary" onPress={() => answer($, card.id, true)} />
                </Box>
              ) : (
                <Button
                  key="reveal"
                  label="Show meaning"
                  hotkey="r"
                  variant="primary"
                  onPress={() => update($, practice, held => ({ ...held, isRevealed: true }))}
                />
              )}
            </Box>
          )}
        </Box>
      )
    }

    const shown = await read($, latest)
    if (shown === null) {
      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          <Text dimColor>
            Type a prompt: its grammar check{now.target === null ? '' : ` and ${now.target} translation`} shows here.
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {tabs}
        <Box flexDirection="column">
          <Text dimColor>You wrote</Text>
          <Text>{shown.text}</Text>
        </Box>
        {shown.status === 'checking' ? <Text dimColor>Checking…</Text> : null}
        {shown.status === 'failed' ? <Text color="error">The check failed: {shown.error}</Text> : null}
        {shown.corrected === undefined ? null : shown.fixes.length === 0 ? (
          <Text color="success">✓ No mistakes found.</Text>
        ) : (
          <Box flexDirection="column">
            <Text dimColor>Corrected</Text>
            <Text color="success">{shown.corrected}</Text>
            {shown.fixes.map(fix => (
              <Text>
                {'• '}
                <Text color="error" strikethrough>
                  {fix.from}
                </Text>
                {' → '}
                <Text color="success">{fix.to}</Text>
                {fix.why === '' ? '' : <Text dimColor> ({fix.why})</Text>}
              </Text>
            ))}
          </Box>
        )}
        {shown.translation === undefined ? null : (
          <Box flexDirection="column">
            <Text dimColor>{shown.target}</Text>
            <Text>{shown.translation}</Text>
          </Box>
        )}
        {shown.words.length === 0 ? null : (
          <Box flexDirection="column">
            <Text dimColor>Saved for practice</Text>
            {shown.words.map(word => (
              <Text>
                <Text bold>{word.word}</Text>
                {` = ${word.meaning}`}
                {word.example === undefined ? '' : <Text dimColor> ({word.example})</Text>}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
