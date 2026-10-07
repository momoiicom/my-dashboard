import { z } from "zod"
import sanitizeHtml from "sanitize-html"

export const BOT_LIMITS = {
  requestBytes: 128 * 1024,
  depth: 8,
  components: 200,
  children: 24,
  chartRows: 200,
  chartSeries: 5,
  tableRows: 200,
  tableColumns: 20,
  listItems: 100,
  text: 12000,
  url: 2048,
  label: 200,
} as const
const text = z.string().max(BOT_LIMITS.text)
const label = z.string().min(1).max(BOT_LIMITS.label)
const gap = z.enum(["small", "medium", "large"])
const key = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/)
  .refine(
    (v) =>
      ![
        "__proto__",
        "prototype",
        "constructor",
        "toString",
        "valueOf",
        "hasOwnProperty",
      ].includes(v),
    "Reserved key"
  )
const url = z
  .string()
  .max(BOT_LIMITS.url)
  .url()
  .refine((v) => {
    const u = new URL(v)
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    )
  }, "Use an absolute HTTP(S) URL without credentials")
const datetime = z.iso.datetime({ offset: true })
const layoutOptions = z.strictObject({ gap }).optional()
const chartSchema = z
  .strictObject({
    component: z.literal("chart"),
    value: z.strictObject({
      type: z.enum(["area", "bar", "line", "pie", "radar", "radial"]),
      title: label.optional(),
      subtitle: label.optional(),
      description: text.optional(),
      xKey: key,
      series: z
        .array(
          z.strictObject({
            key,
            label,
            color: z
              .string()
              .regex(/^#[0-9a-fA-F]{6}$/)
              .optional(),
          })
        )
        .min(1)
        .max(BOT_LIMITS.chartSeries),
      data: z
        .array(z.record(key, z.union([text, z.number()])))
        .min(1)
        .max(BOT_LIMITS.chartRows),
    }),
    options: z
      .strictObject({
        legend: z.boolean().optional(),
        tooltip: z.boolean().optional(),
        height: z.number().int().min(180).max(600).optional(),
        curve: z.enum(["linear", "natural", "step"]).optional(),
        stacking: z.enum(["none", "stacked", "percent"]).optional(),
        gradient: z.boolean().optional(),
        axes: z.boolean().optional(),
        grid: z.boolean().optional(),
        lineWidth: z.number().int().min(1).max(6).optional(),
        donut: z.boolean().optional(),
      })
      .optional(),
  })
  .superRefine(({ value: v, options }, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message })
    const keys = v.series.map((s) => s.key)
    if (new Set(keys).size !== keys.length || keys.includes(v.xKey))
      issue(
        ["value", "series"],
        "Series keys must be unique and differ from xKey"
      )
    const circular = v.type === "pie" || v.type === "radial"
    if (circular && keys.length !== 1)
      issue(
        ["value", "series"],
        "Pie and radial charts require exactly one series"
      )
    v.data.forEach((row, i) => {
      if (!Object.hasOwn(row, v.xKey))
        issue(["value", "data", i, v.xKey], "Missing xKey label")
      for (const k of keys)
        if (typeof row[k] !== "number" || (circular && row[k] < 0))
          issue(
            ["value", "data", i, k],
            circular
              ? "Expected a nonnegative number"
              : "Expected a finite number"
          )
      for (const k of Object.keys(row))
        if (k !== v.xKey && !keys.includes(k))
          issue(["value", "data", i, k], "Undeclared data key")
    })
    if (
      v.type === "pie" &&
      !v.data.some(
        (row) => typeof row[keys[0]] === "number" && Number(row[keys[0]]) > 0
      )
    )
      issue(["value", "data"], "Pie values must have a positive total")
    const allowed: Record<string, string[]> = {
      curve: ["area", "line"],
      lineWidth: ["area", "line"],
      stacking: ["area", "bar"],
      gradient: ["area"],
      axes: ["area", "bar", "line", "radar"],
      grid: ["area", "bar", "line", "radar"],
      donut: ["pie"],
    }
    for (const [option, types] of Object.entries(allowed))
      if (options && option in options && !types.includes(v.type))
        issue(["options", option], `Not supported for ${v.type}`)
  })
const tableSchema = z
  .strictObject({
    component: z.literal("table"),
    value: z.strictObject({
      columns: z
        .array(z.strictObject({ key, label }))
        .min(1)
        .max(BOT_LIMITS.tableColumns),
      rows: z
        .array(
          z.record(key, z.union([text, z.number(), z.boolean(), z.null()]))
        )
        .max(BOT_LIMITS.tableRows),
    }),
    options: z.strictObject({ caption: label.optional() }).optional(),
  })
  .superRefine(({ value }, ctx) => {
    const keys = value.columns.map((c) => c.key)
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: "custom",
        path: ["value", "columns"],
        message: "Column keys must be unique",
      })
    value.rows.forEach((row, i) => {
      if (
        Object.keys(row).length !== keys.length ||
        keys.some((k) => !Object.hasOwn(row, k))
      )
        ctx.addIssue({
          code: "custom",
          path: ["value", "rows", i],
          message: "Row keys must exactly match declared columns",
        })
    })
  })
export const displayComponentSchema = z.discriminatedUnion("component", [
  z.strictObject({
    component: z.literal("title"),
    value: text,
    options: z
      .strictObject({
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      })
      .optional(),
  }),
  z.strictObject({ component: z.literal("paragraph"), value: text }),
  z.strictObject({ component: z.literal("richtext"), value: text }),
  z.strictObject({
    component: z.literal("image"),
    value: z.strictObject({ src: url, alt: text, caption: text.optional() }),
    options: z.strictObject({ fit: z.enum(["contain", "cover"]) }).optional(),
  }),
  z.strictObject({
    component: z.literal("metric"),
    value: z.strictObject({
      label,
      value: z.union([text, z.number()]),
      detail: text.optional(),
    }),
  }),
  z.strictObject({
    component: z.literal("status"),
    value: z.strictObject({
      label,
      tone: z.enum(["neutral", "success", "warning", "danger", "info"]),
      description: text.optional(),
    }),
  }),
  z.strictObject({
    component: z.literal("timestamp"),
    value: datetime,
    options: z.strictObject({ label: label.optional() }).optional(),
  }),
  z.strictObject({
    component: z.literal("list"),
    value: z.array(text).max(BOT_LIMITS.listItems),
    options: z.strictObject({ ordered: z.boolean() }).optional(),
  }),
  z.strictObject({
    component: z.literal("link"),
    value: z.strictObject({ href: url, label, description: text.optional() }),
  }),
  z.strictObject({ component: z.literal("divider") }),
  tableSchema,
  z.strictObject({
    component: z.literal("map"),
    value: z.strictObject({
      latitude: z.number().min(-85).max(85),
      longitude: z.number().min(-180).max(180),
      label: label.optional(),
    }),
    options: z
      .strictObject({ zoom: z.number().int().min(1).max(18) })
      .optional(),
  }),
  chartSchema,
  z.strictObject({
    component: z.literal("row"),
    get value(): z.ZodArray<typeof displayComponentSchema> {
      return z.array(displayComponentSchema).max(BOT_LIMITS.children)
    },
    options: layoutOptions,
  }),
  z.strictObject({
    component: z.literal("column"),
    get value(): z.ZodArray<typeof displayComponentSchema> {
      return z.array(displayComponentSchema).max(BOT_LIMITS.children)
    },
    options: layoutOptions,
  }),
  z.strictObject({
    component: z.literal("grid"),
    value: z.strictObject({
      columns: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
      ]),
      get children(): z.ZodArray<typeof displayComponentSchema> {
        return z.array(displayComponentSchema).max(BOT_LIMITS.children)
      },
    }),
    options: layoutOptions,
  }),
])
export const botDocumentSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  title: z.string().trim().min(1).max(120),
  updatedAt: datetime.optional(),
  layout: z
    .strictObject({ direction: z.enum(["vertical", "horizontal"]), gap })
    .default({ direction: "vertical", gap: "medium" }),
  components: z.array(displayComponentSchema).min(1).max(BOT_LIMITS.children),
})
export type DisplayComponent = z.infer<typeof displayComponentSchema>
export type BotDocument = z.infer<typeof botDocumentSchema>
export type BotIssue = { path: string; message: string }
export class BotDocumentError extends Error {
  constructor(public issues: BotIssue[]) {
    super("Invalid bot document")
  }
}

function checkComplexity(input: unknown) {
  const stack = [{ value: input, depth: 0, path: "" }]
  while (stack.length) {
    const entry = stack.pop()!
    if (!entry.value || typeof entry.value !== "object") continue
    if (entry.depth > 30)
      throw new BotDocumentError([
        { path: entry.path, message: "Document nesting is too deep" },
      ])
    for (const [k, v] of Object.entries(entry.value))
      stack.push({
        value: v,
        depth: entry.depth + 1,
        path: entry.path ? `${entry.path}.${k}` : k,
      })
  }
}
export function parseBotDocument(input: unknown): BotDocument {
  checkComplexity(input)
  const parsed = botDocumentSchema.safeParse(input)
  if (!parsed.success)
    throw new BotDocumentError(
      parsed.error.issues
        .slice(0, 25)
        .map((i) => ({ path: i.path.join("."), message: i.message }))
    )
  let count = 0
  function normalize(
    components: DisplayComponent[],
    depth: number,
    path: string
  ): DisplayComponent[] {
    if (depth > BOT_LIMITS.depth)
      throw new BotDocumentError([
        { path, message: `Maximum component depth is ${BOT_LIMITS.depth}` },
      ])
    return components.map((c, i) => {
      if (++count > BOT_LIMITS.components)
        throw new BotDocumentError([
          {
            path: `${path}.${i}`,
            message: `Maximum ${BOT_LIMITS.components} components`,
          },
        ])
      if (c.component === "richtext") {
        const value = sanitizeHtml(c.value, {
          allowedTags: [
            "p",
            "br",
            "strong",
            "b",
            "em",
            "i",
            "u",
            "s",
            "sub",
            "sup",
            "blockquote",
            "pre",
            "code",
            "ul",
            "ol",
            "li",
            "h1",
            "h2",
            "h3",
            "a",
          ],
          allowedAttributes: { a: ["href", "title", "rel"] },
          allowedSchemes: ["http", "https"],
          allowProtocolRelative: false,
          transformTags: {
            a: (_tag, attrs) => ({
              tagName: "a",
              attribs: {
                ...(attrs.href && url.safeParse(attrs.href).success
                  ? { href: attrs.href }
                  : {}),
                ...(attrs.title ? { title: attrs.title } : {}),
                rel: "noopener noreferrer",
              },
            }),
          },
        })
        if (value.length > BOT_LIMITS.text)
          throw new BotDocumentError([
            {
              path: `${path}.${i}.value`,
              message: `Sanitized richtext exceeds ${BOT_LIMITS.text} characters`,
            },
          ])
        return { ...c, value }
      }
      if (c.component === "row" || c.component === "column")
        return {
          ...c,
          value: normalize(c.value, depth + 1, `${path}.${i}.value`),
        }
      if (c.component === "grid")
        return {
          ...c,
          value: {
            ...c.value,
            children: normalize(
              c.value.children,
              depth + 1,
              `${path}.${i}.value.children`
            ),
          },
        }
      return c
    })
  }
  return {
    ...parsed.data,
    components: normalize(parsed.data.components, 1, "components"),
  }
}

export const BOT_EXAMPLE = {
  schemaVersion: "1",
  title: "Service overview",
  updatedAt: "2026-10-04T12:00:00Z",
  components: [
    {
      component: "metric",
      value: { label: "Requests", value: 1240, detail: "Today" },
    },
    {
      component: "chart",
      value: {
        type: "area",
        xKey: "day",
        series: [{ key: "requests", label: "Requests" }],
        data: [
          { day: "Mon", requests: 820 },
          { day: "Tue", requests: 1240 },
        ],
      },
      options: { gradient: true, axes: true, grid: true },
    },
  ],
} satisfies z.input<typeof botDocumentSchema>
export const BOT_COMPONENT_EXAMPLES = [
  { component: "title", value: "Agent daily report", options: { level: 2 } },
  {
    component: "paragraph",
    value: "This card is a read-only report sent through the bot API.",
  },
  {
    component: "richtext",
    value:
      '<h3>Report details</h3><p>Safe <strong>rich text</strong>, H<sub>2</sub>O and a <a href="https://example.com">reference</a>.</p><ul><li>First item</li><li>Second item</li></ul>',
  },
  {
    component: "metric",
    value: { label: "Messages", value: 69, detail: "Last three days" },
  },
  {
    component: "status",
    value: {
      label: "Online",
      tone: "success",
      description: "Last bot report received",
    },
  },
  {
    component: "row",
    value: [
      {
        component: "metric",
        value: { label: "Messages", value: 69, detail: "Last three days" },
      },
      {
        component: "status",
        value: {
          label: "Online",
          tone: "success",
          description: "Last bot report received",
        },
      },
    ],
    options: { gap: "medium" },
  },
  {
    component: "timestamp",
    value: "2026-10-04T08:00:00Z",
    options: { label: "Observed at" },
  },
  { component: "divider" },
  {
    component: "table",
    value: {
      columns: [
        { key: "day", label: "Day" },
        { key: "count", label: "Messages" },
      ],
      rows: [
        { day: "Monday", count: 22 },
        { day: "Tuesday", count: 23 },
      ],
    },
    options: { caption: "Bot-provided table" },
  },
  {
    component: "list",
    value: ["Check one", "Check two"],
    options: { ordered: true },
  },
  {
    component: "link",
    value: {
      href: "https://example.com",
      label: "Example reference",
      description: "Informational navigation",
    },
  },
  {
    component: "image",
    value: {
      src: "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=640&q=80",
      alt: "Mountain lake",
      caption: "Illustrative image",
    },
    options: { fit: "contain" },
  },
  {
    component: "column",
    value: [{ component: "paragraph", value: "Column layout" }],
  },
  {
    component: "grid",
    value: {
      columns: 2,
      children: [
        { component: "paragraph", value: "Grid cell A" },
        { component: "paragraph", value: "Grid cell B" },
      ],
    },
  },
  {
    component: "chart",
    value: {
      type: "area",
      title: "Area chart",
      subtitle: "Illustrative verification data",
      description: "Bot supplied values for three days.",
      xKey: "day",
      series: [{ key: "count", label: "Messages", color: "#85B8FF" }],
      data: [
        { day: "Monday", count: 22 },
        { day: "Tuesday", count: 23 },
        { day: "Wednesday", count: 24 },
      ],
    },
    options: {
      curve: "natural",
      gradient: true,
      legend: true,
      tooltip: true,
      axes: true,
      grid: true,
    },
  },
  {
    component: "chart",
    value: {
      type: "bar",
      title: "Bar chart",
      subtitle: "Illustrative verification data",
      description: "Bot supplied values for three days.",
      xKey: "day",
      series: [{ key: "count", label: "Messages", color: "#85B8FF" }],
      data: [
        { day: "Monday", count: 22 },
        { day: "Tuesday", count: 23 },
        { day: "Wednesday", count: 24 },
      ],
    },
    options: { stacking: "none", legend: true, tooltip: true, axes: true },
  },
  {
    component: "chart",
    value: {
      type: "line",
      title: "Line chart",
      subtitle: "Illustrative verification data",
      description: "Bot supplied values for three days.",
      xKey: "day",
      series: [{ key: "count", label: "Messages", color: "#85B8FF" }],
      data: [
        { day: "Monday", count: 22 },
        { day: "Tuesday", count: 23 },
        { day: "Wednesday", count: 24 },
      ],
    },
    options: { curve: "linear", lineWidth: 2, legend: true },
  },
  {
    component: "chart",
    value: {
      type: "pie",
      title: "Pie chart",
      subtitle: "Illustrative verification data",
      description: "Bot supplied values for three days.",
      xKey: "day",
      series: [{ key: "count", label: "Messages", color: "#85B8FF" }],
      data: [
        { day: "Monday", count: 22 },
        { day: "Tuesday", count: 23 },
        { day: "Wednesday", count: 24 },
      ],
    },
    options: { donut: true, legend: true },
  },
  {
    component: "chart",
    value: {
      type: "radar",
      title: "Radar chart",
      subtitle: "Illustrative verification data",
      description: "Bot supplied values for three days.",
      xKey: "day",
      series: [{ key: "count", label: "Messages", color: "#85B8FF" }],
      data: [
        { day: "Monday", count: 22 },
        { day: "Tuesday", count: 23 },
        { day: "Wednesday", count: 24 },
      ],
    },
    options: { legend: true, axes: true, grid: true },
  },
  {
    component: "chart",
    value: {
      type: "radial",
      title: "Radial chart",
      subtitle: "Illustrative verification data",
      description: "Bot supplied values for three days.",
      xKey: "day",
      series: [{ key: "count", label: "Messages", color: "#85B8FF" }],
      data: [
        { day: "Monday", count: 22 },
        { day: "Tuesday", count: 23 },
        { day: "Wednesday", count: 24 },
      ],
    },
    options: { legend: true },
  },
  {
    component: "map",
    value: { latitude: 51.5074, longitude: -0.1278, label: "London" },
    options: { zoom: 11 },
  },
] satisfies z.input<typeof displayComponentSchema>[]
export function getBotCapabilities() {
  return {
    schemaVersion: "1",
    limits: BOT_LIMITS,
    jsonSchema: z.toJSONSchema(botDocumentSchema),
    components: displayComponentSchema.options.map((s) => ({
      component: s.shape.component.value,
      schema: z.toJSONSchema(s),
      examples: BOT_COMPONENT_EXAMPLES.filter(
        (example) => example.component === s.shape.component.value
      ),
    })),
    example: BOT_EXAMPLE,
    boards: {
      discovery: "/api/bot/boards",
      filters: ["name", "id"],
      initialBoardQuery: "boardId",
      keyScope: "owner",
      defaultDestination: "original board",
      responseBoardField: "card.boardId",
    },
    notifications: {
      updateQuery: "notify=true",
      default: "silent",
      eligibility: "changed existing card only",
      receipt: "push-service acceptance, not device display",
    },
    rules: [
      "Discover a requested board by name or ID before creating a card. Names ignore capitalization and surrounding spaces. Ask the user when the requested board is missing.",
      "New card keys use the boardId query or the original board. Keys are owner-wide; use distinct keys for separate cards.",
      "Existing keys update their current board regardless of the initial board hint, including after transfers or deletion of the old board. Responses include the actual boardId.",
      "Only listed properties are accepted. Geometry, owner and id are never bot writable.",
      "Maximum component depth is 8 and total component count is 200.",
      "Richtext is sanitized before storage. Both raw and sanitized HTML must fit the text limit. Only safe HTTP(S) anchors and listed text markup survive.",
      "Table keys are unique; each row contains exactly the declared columns.",
      "Chart keys are unique and safe, xKey differs from series keys, every series value is finite numeric, no undeclared row keys.",
      "Pie and radial require one nonnegative series. Pie total must be positive. Radial bars compare values on a shared zero-to-maximum scale.",
      "Curve and lineWidth apply only to area/line; stacking to area/bar; gradient to area; axes/grid to area/bar/line/radar; donut to pie.",
      "Maps display one coordinate using OpenStreetMap. Images load in the browser with no referrer.",
      "Root layout defaults to vertical with medium gap. Nested layout defaults to medium gap.",
    ],
  }
}
