# cc-lingo

A language partner for [Claude Code](https://claude.com/claude-code). Choose a language you're learning, then keep working as normal. Each prompt you type gets a grammar check and a translation into that language, shown above the prompt. Useful words from the translation are saved as flashcards for you to practise later.

For example, typing `can you recieve the file and check it` while learning Japanese shows:

```
✎ recieve → receive                                         Details  Hide
Japanese: ファイルを受け取って確認してもらえますか
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install language-partner --marketplace quanta-studio/cc-lingo
```

Answer `y` to add the marketplace, then pick a scope (Enter keeps the user scope). The mod starts working in that session straight away.

From a shell:

```sh
claude plugin install language-partner --marketplace quanta-studio/cc-lingo
```

In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, choose **Plugins**, then **Add marketplace** with `quanta-studio/cc-lingo`, then **Add plugin**.

## Use

| Command | What it does |
| --- | --- |
| `/lang Japanese` | Start learning a language. Any language name works, e.g. `/lang Brazilian Portuguese`. |
| `/lang` | Show what you're learning and open the **Language partner** pane. |
| `/lang practice` | Practise your saved words as flashcards in the pane. |
| `/lang level intermediate` | Choose words for a `beginner`, `intermediate` or `advanced` learner. |
| `/lang off` | Stop translating. Your saved words are kept. |
| `/grammar on` / `/grammar off` | Turn grammar checks on or off. They're on by default. |

**The band above the prompt** appears after each prompt you type. It shows up to two grammar fixes and the translation. **Details** opens the pane, which shows the corrected text, the reason for each fix, and the words saved from that prompt. **Hide** dismisses the band until your next prompt.

**Practice** shows the word you know least, or have gone longest without seeing. Press `r` to reveal its meaning and an example sentence, then press `g` (Got it) or `a` (Again). Got it moves the card up one of five boxes. Again sends it back to the first. `l` and `p` switch between the pane's tabs.

### What gets checked

- Only prompts you type yourself are checked. Slash commands, replies under three words, and pastes over 4,000 characters are skipped.
- Code, file paths, identifiers, URLs and markdown are not corrected or translated. Casual style is also left alone, such as a missing final period.
- If a prompt is already in the language you're learning, it's translated into English instead.
- Each prompt saves up to three words. The deck keeps the newest 500 words across all your languages.

### Privacy and cost

Each checked prompt is sent to Claude Haiku through your Claude Code session, so it counts toward your usage like any other model call. The check runs in the background and never holds up your prompt. Claude Code keeps your settings and flashcard deck between sessions.

## Develop

```sh
claude --plugin-dir .      # start a session with the mod loaded from this folder
claude plugin validate .   # check the manifest, marketplace file and hooks module
claude plugin test .       # run tests/*.test.ts
tsc -p .                   # type-check (needs TypeScript and the generated types, see below)
```

In an interactive `--plugin-dir` session, saving a file reloads the mod.

When Claude Code loads the mod, it writes the API types to `.claude-plugin/types/`. The root `tsconfig.json` extends the config in that folder, so run `claude --plugin-dir .` once before type-checking. The folder is git-ignored.

### Layout

| Path | What's in it |
| --- | --- |
| `hooks/register.tsx` | The hooks: prompt checks, the `/lang` and `/grammar` commands, the band and the pane |
| `hooks/coach.ts` | Pure logic: the tutor prompt, reply parsing, flashcard picking and grading |
| `types/index.d.ts` | Shared types and the mod's `$.state` contract |
| `tests/language-partner.test.ts` | Tests, run with `claude plugin test` |
| `.claude-plugin/` | The plugin manifest and the marketplace file |
