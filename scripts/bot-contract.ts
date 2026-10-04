import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  BOT_COMPONENT_EXAMPLES,
  BOT_EXAMPLE,
  BotDocumentError,
  getBotCapabilities,
  parseBotDocument,
} from "../lib/bot-document"
const parsed = parseBotDocument(BOT_EXAMPLE)
assert.deepEqual(parsed.layout, { direction: "vertical", gap: "medium" })
assert.ok(JSON.stringify(getBotCapabilities()).includes("$ref"))
const rich = parseBotDocument({
  schemaVersion: "1",
  title: "Safe",
  components: [
    {
      component: "richtext",
      value:
        '<h2 onclick="evil()">Hello</h2><script>evil()</script><a href="javascript:evil()">bad</a><a href="https://example.com">good</a><sup>2</sup>',
    },
  ],
})
assert.equal(rich.components[0].component, "richtext")
assert.equal(
  rich.components[0].value,
  '<h2>Hello</h2><a rel="noopener noreferrer">bad</a><a href="https://example.com" rel="noopener noreferrer">good</a><sup>2</sup>'
)
const document = (component: unknown) => ({
  schemaVersion: "1",
  title: "Test",
  components: [component],
})
const escaped = parseBotDocument(
  document({ component: "richtext", value: "&".repeat(2000) })
)
assert.equal(escaped.components[0].component, "richtext")
assert.equal(escaped.components[0].value, "&amp;".repeat(2000))
assert.deepEqual(parseBotDocument(JSON.parse(JSON.stringify(escaped))), escaped)
const rejects = (value: unknown, path: string) =>
  assert.throws(
    () => parseBotDocument(value),
    (error) =>
      error instanceof BotDocumentError &&
      error.issues.some((issue) => issue.path.includes(path))
  )
rejects({ ...BOT_EXAMPLE, x: 12 }, "")
rejects(
  document({
    component: "image",
    value: { src: "https://user:password@example.com/a", alt: "Unsafe" },
  }),
  "src"
)
rejects(
  document({
    component: "table",
    value: {
      columns: [{ key: "name", label: "Name" }],
      rows: [{ wrong: "value" }],
    },
  }),
  "rows"
)
rejects(
  document({
    component: "chart",
    value: {
      type: "pie",
      xKey: "name",
      series: [{ key: "amount", label: "Amount" }],
      data: [{ name: "A", amount: 0 }],
    },
    options: { curve: "linear" },
  }),
  "options.curve"
)
rejects(
  document({
    component: "chart",
    value: {
      type: "line",
      xKey: "name",
      series: [{ key: "amount", label: "Amount" }],
      data: [{ name: "A", amount: "12" }],
    },
  }),
  "amount"
)
rejects(
  document({
    component: "chart",
    value: {
      type: "line",
      xKey: "toLocaleString",
      series: [{ key: "amount", label: "Amount" }],
      data: [{ amount: 5 }],
    },
  }),
  "toLocaleString"
)
parseBotDocument(
  document({
    component: "chart",
    value: {
      type: "line",
      xKey: "toLocaleString",
      series: [{ key: "amount", label: "Amount" }],
      data: [{ toLocaleString: "A", amount: 5 }],
    },
  })
)
let nested: unknown = { component: "paragraph", value: "Deep" }
for (let i = 0; i < 8; i++) nested = { component: "row", value: [nested] }
rejects(document(nested), "value")
if (process.argv[2])
  parseBotDocument(JSON.parse(readFileSync(process.argv[2], "utf8")))
const componentColumn = document({
  component: "table",
  value: {
    columns: [{ key: "component", label: "Component" }],
    rows: Array.from({ length: 200 }, () => ({ component: "value" })),
  },
})
assert.equal(parseBotDocument(componentColumn).components.length, 1)
assert.throws(
  () =>
    parseBotDocument(
      document({
        component: "list",
        value: Array.from({ length: 100 }, () => 123),
      })
    ),
  (error) => error instanceof BotDocumentError && error.issues.length === 25
)

for (const example of BOT_COMPONENT_EXAMPLES)
  parseBotDocument(document(example))
rejects(
  document({ component: "richtext", value: "&".repeat(3000) }),
  "components.0.value"
)
console.log("Bot document contract checks passed")
