import { cn } from "cn"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { BotChart } from "@/components/bot-chart"
import type { BotDocument, DisplayComponent } from "@/lib/bot-document"

type Gap = "small" | "medium" | "large"
const gapClass: Record<Gap, string> = {
  small: "bot-gap-small",
  medium: "bot-gap-medium",
  large: "bot-gap-large",
}
const date = (value: string) => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : `${parsed.toISOString().slice(0, 19).replace("T", " ")} UTC`
}

function Component({ item }: { item: DisplayComponent }) {
  switch (item.component) {
    case "title": {
      const level = item.options?.level ?? 2
      return level === 1 ? (
        <h3 className="bot-title bot-title-1">{item.value}</h3>
      ) : level === 3 ? (
        <h5 className="bot-title bot-title-3">{item.value}</h5>
      ) : (
        <h4 className="bot-title bot-title-2">{item.value}</h4>
      )
    }
    case "paragraph":
      return <p className="bot-paragraph">{item.value}</p>
    case "richtext":
      return (
        <div
          className="bot-richtext"
          dangerouslySetInnerHTML={{ __html: item.value }}
        />
      )
    case "image":
      return (
        <figure className="bot-image">
          <img
            src={item.value.src}
            alt={item.value.alt}
            referrerPolicy="no-referrer"
            loading="lazy"
            style={{ objectFit: item.options?.fit ?? "contain" }}
          />
          {item.value.caption && <figcaption>{item.value.caption}</figcaption>}
        </figure>
      )
    case "metric":
      return (
        <div className="bot-metric">
          <span>{item.value.label}</span>
          <strong>{item.value.value}</strong>
          {item.value.detail && <small>{item.value.detail}</small>}
        </div>
      )
    case "status":
      return (
        <div className="bot-status">
          <Badge
            className={cn(`bot-status-${item.value.tone}`)}
            variant="secondary"
          >
            {item.value.label}
          </Badge>
          {item.value.description && <span>{item.value.description}</span>}
        </div>
      )
    case "timestamp":
      return (
        <p className="bot-timestamp">
          <span>{item.options?.label ?? "Time"}</span>{" "}
          <time dateTime={item.value}>{date(item.value)}</time>
        </p>
      )
    case "list":
      return item.options?.ordered ? (
        <ol className="bot-list bot-list-ordered">
          {item.value.map((entry, index) => (
            <li key={index}>{entry}</li>
          ))}
        </ol>
      ) : (
        <ul className="bot-list">
          {item.value.map((entry, index) => (
            <li key={index}>{entry}</li>
          ))}
        </ul>
      )
    case "link":
      return (
        <a
          className="bot-link"
          href={item.value.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {item.value.label}
          {item.value.description && <small>{item.value.description}</small>}
        </a>
      )
    case "divider":
      return <Separator />
    case "table":
      return (
        <Table>
          {item.options?.caption && (
            <TableCaption>{item.options.caption}</TableCaption>
          )}
          <TableHeader>
            <TableRow>
              {item.value.columns.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {item.value.rows.map((row, index) => (
              <TableRow key={index}>
                {item.value.columns.map((column) => (
                  <TableCell key={column.key}>
                    {row[column.key] === null ? "—" : String(row[column.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )
    case "map": {
      const { latitude, longitude, label } = item.value
      const zoom = item.options?.zoom ?? 12
      const delta = 180 / 2 ** zoom
      const west = Math.max(-180, longitude - delta)
      const east = Math.min(180, longitude + delta)
      const south = Math.max(-85, latitude - delta / 2)
      const north = Math.min(85, latitude + delta / 2)
      const bbox = [west, south, east, north].join(",")
      const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${latitude},${longitude}`)}`
      return (
        <figure className="bot-map">
          <iframe
            title={
              label ? `Map of ${label}` : `Map at ${latitude}, ${longitude}`
            }
            src={src}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <figcaption>
            {label && <strong>{label} · </strong>}
            {latitude.toFixed(4)}, {longitude.toFixed(4)} ·{" "}
            <a
              href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=${zoom}/${latitude}/${longitude}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              © OpenStreetMap contributors
            </a>
          </figcaption>
        </figure>
      )
    }
    case "chart":
      return <BotChart item={item} />
    case "row":
    case "column":
      return (
        <div
          className={cn(
            "bot-layout",
            `bot-layout-${item.component}`,
            gapClass[item.options?.gap ?? "medium"]
          )}
        >
          {item.value.map((child, index) => (
            <div className="bot-layout-child" key={index}>
              <Component item={child} />
            </div>
          ))}
        </div>
      )
    case "grid":
      return (
        <div
          className={cn(
            "bot-layout bot-layout-grid",
            `bot-grid-${item.value.columns}`,
            gapClass[item.options?.gap ?? "medium"]
          )}
        >
          {item.value.children.map((child, index) => (
            <div className="bot-layout-child" key={index}>
              <Component item={child} />
            </div>
          ))}
        </div>
      )
    default: {
      const unsupported: never = item
      throw new Error(`Unsupported display component: ${unsupported}`)
    }
  }
}

export function BotCardRenderer({
  document,
  acceptedAt,
}: {
  document: BotDocument
  acceptedAt?: string | null
}) {
  return (
    <div className="bot-document">
      <div
        className={cn(
          "bot-layout",
          `bot-layout-${document.layout?.direction ?? "vertical"}`,
          gapClass[document.layout?.gap ?? "medium"]
        )}
      >
        {document.components.map((item, index) => (
          <div className="bot-layout-child" key={index}>
            <Component item={item} />
          </div>
        ))}
      </div>
      {(document.updatedAt || acceptedAt) && (
        <div className="bot-provenance">
          {document.updatedAt && (
            <span>
              Bot updated{" "}
              <time dateTime={document.updatedAt}>
                {date(document.updatedAt)}
              </time>
            </span>
          )}
          {acceptedAt && (
            <span>
              Accepted <time dateTime={acceptedAt}>{date(acceptedAt)}</time>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
