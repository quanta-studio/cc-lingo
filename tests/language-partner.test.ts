import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { addWords, grade, languageName, nextCard, normalizeDeck, parseReply } from '../hooks/coach'

const PLUGIN = 'language-partner'
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REPLY = JSON.stringify({
  language: 'English',
  corrected: 'Learning a foreign language of my choice',
  fixes: [{ from: 'on my choices', to: 'of my choice', why: '"of my choice" is the set phrase' }],
  translation: 'Aprender un idioma extranjero de mi elección',
  words: [{ word: 'elección', meaning: 'choice', example: 'Es mi elección.' }],
})
const JAPANESE = JSON.stringify({
  language: 'English',
  corrected: 'Please check the file',
  fixes: [],
  translation: 'ファイルを確認してください',
  pronunciation: 'fairu o kakunin shite kudasai',
  words: [{ word: '確認', pronunciation: 'kakunin', meaning: 'check', example: '確認します。' }],
})
const BAND: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}
const PANE: RenderPropsOf['Pane'] = {
  title: 'Language partner',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

/** The engine beneath the mod: a store and clock in memory, and a tutor model that always gives `reply`. */
function world(on: On, reply = REPLY) {
  mock.store(on)
  const clock = mock.clock(on, { now: 1000 })
  const asked: { system: string; prompt: string }[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('model.complete', ($, e) => {
    asked.push({ system: e.system ?? '', prompt: e.prompt })

    return { value: { isAnswered: true as const, text: reply, usage: USAGE } }
  })

  return { clock, asked }
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } as const })
const slash = (command: string, args = '') => ({
  command,
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: true, columns: 160 },
})

describe('checking prompts', () => {
  test('a typed prompt is corrected, translated, and its words saved', async ($, on) => {
    const { clock, asked } = world(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const picked = await $.command.run(slash('lang', 'spanish'))
    expect(picked.text).toContain('Now learning Spanish')

    await $.prompt.submit(typed('Learning a foreign language on my choices'))
    await clock.settle()

    expect(asked).toHaveLength(1)
    expect(asked[0]?.system).toContain('into Spanish')
    expect(asked[0]?.prompt).toContain('on my choices')

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
      expect(await band.find({ text: 'of my choice' })).toBeDefined()
      expect(await band.find({ text: /Aprender un idioma/ })).toBeDefined()
      await band.unmount()
    }

    const status = await $.command.run(slash('lang'))
    expect(status.text).toContain('1 word to practice')
  })

  test('a language in another script shows how its translation and words sound', async ($, on) => {
    const { clock, asked } = world(on, JAPANESE)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await $.command.run(slash('lang', 'japanese'))

    await $.prompt.submit(typed('Please check the file'))
    await clock.settle()

    expect(asked[0]?.system).toContain('Latin letters')

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
      expect(await band.find({ text: /fairu o kakunin shite kudasai/ })).toBeDefined()
      await band.unmount()

      const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PANE, requestId: PLUGIN })
      expect(await pane.find({ text: /fairu o kakunin shite kudasai/ })).toBeDefined()
      expect(await pane.find({ text: '確認 kakunin = check' })).toBeDefined()
      await pane.unmount()
    }

    await $.command.run(slash('lang', 'practice'))
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PANE, requestId: PLUGIN })
      expect(await pane.find({ text: '確認' })).toBeDefined()
      expect(await pane.find({ text: /kakunin/ })).toBeUndefined()
      await pane.press({ key: 'reveal' })
      expect(await pane.find({ text: /kakunin/ })).toBeDefined()
      await pane.press({ key: 'again' })
      await pane.unmount()
    }
  })

  test('slash commands, short replies and plugin prompts are left alone', async ($, on) => {
    const { clock, asked } = world(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

    await $.prompt.submit(typed('yes please'))
    await $.prompt.submit({ ...typed('/compact keep it all'), command: { name: 'compact', args: 'keep it all' } })
    await $.prompt.submit({ text: 'a message from a plugin', wait: false, origin: { kind: 'plugin', name: 'other' } })
    await clock.settle()

    expect(asked).toHaveLength(0)
  })

  test('/grammar off with no language asks the model nothing', async ($, on) => {
    const { clock, asked } = world(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await $.command.run(slash('grammar', 'off'))

    await $.prompt.submit(typed('this sentence have a mistake'))
    await clock.settle()

    expect(asked).toHaveLength(0)
  })

  test('a reply that is not JSON shows as a failed check', async ($, on) => {
    const { clock } = world(on, 'Sorry, I cannot help with that.')
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

    await $.prompt.submit(typed('this sentence have a mistake'))
    await clock.settle()

    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: /check failed/ })).toBeDefined()
  })
})

describe('practice', () => {
  test('a card is revealed, then graded, and the next one shown', async ($, on) => {
    const { clock } = world(on, JSON.stringify({ language: 'English', corrected: 'x', fixes: [], translation: 'y', words: [
      { word: 'gato', meaning: 'cat' },
      { word: 'perro', meaning: 'dog' },
    ] }))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await $.command.run(slash('lang', 'Spanish'))
    await $.prompt.submit(typed('the cat and the dog'))
    await clock.settle()
    await $.command.run(slash('lang', 'practice'))

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PANE, requestId: PLUGIN })
      expect(await pane.find({ text: 'gato' })).toBeDefined()
      expect(await pane.find({ text: 'cat' })).toBeUndefined()
      await pane.press({ key: 'reveal' })
      expect(await pane.find({ text: 'cat' })).toBeDefined()
      await pane.press({ key: 'known' })
      expect(await pane.find({ text: 'perro' })).toBeDefined()
      await pane.press({ key: 'reveal' })
      await pane.press({ key: 'again' })
      await pane.unmount()
    }
  })
})

describe('coach', () => {
  test('replies are read through code fences and junk', () => {
    const reply = parseReply('```json\n' + REPLY + '\n```')
    expect(reply?.fixes[0]?.to).toBe('of my choice')
    expect(reply?.words[0]?.word).toBe('elección')
    expect(parseReply('no json here')).toBeUndefined()
    expect(parseReply('{"fixes": [{"from": "a", "to": "a"}]}')?.fixes).toEqual([])
  })

  test('pronunciations are read from the reply and kept in the deck', () => {
    const reply = parseReply(JAPANESE)
    expect(reply?.pronunciation).toBe('fairu o kakunin shite kudasai')
    expect(reply?.words[0]?.pronunciation).toBe('kakunin')
    expect(parseReply(REPLY)?.pronunciation).toBeUndefined()

    const deck = normalizeDeck(addWords([], reply?.words ?? [], 'Japanese', 1))
    expect(deck[0]?.pronunciation).toBe('kakunin')
  })

  test('language names are tidied and nonsense refused', () => {
    expect(languageName(' brazilian   portuguese ')).toBe('Brazilian Portuguese')
    expect(languageName('日本語')).toBe('日本語')
    expect(languageName('rm -rf /')).toBeUndefined()
  })

  test('the least known card comes next and words are not saved twice', () => {
    const deck = addWords([], [{ word: 'Hola', meaning: 'hello' }, { word: 'adiós', meaning: 'bye' }], 'Spanish', 1)
    expect(addWords(deck, [{ word: 'hola', meaning: 'hi' }], 'Spanish', 2)).toHaveLength(2)
    const graded = grade(deck, 'Spanish:hola', true, 3)
    expect(nextCard(graded, 'Spanish')?.word).toBe('adiós')
    expect(nextCard(graded, 'French')).toBeUndefined()
  })
})
