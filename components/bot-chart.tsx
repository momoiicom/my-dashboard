"use client"

import { useId } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { DisplayComponent } from "@/lib/bot-document"

type ChartComponent = Extract<DisplayComponent, { component: "chart" }>
const palette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

export function BotChart({ item }: { item: ChartComponent }) {
  const gradientPrefix = useId().replace(/:/g, "")
  const { value, options } = item
  const { type, xKey, series, data } = value
  const colors = series.map((entry, index) => entry.color ?? palette[index])
  const circular = type === "pie" || type === "radial"
  const categoryColors = data.map((_, index) =>
    index === 0 && series[0].color
      ? series[0].color
      : palette[index % palette.length]
  )
  const config = Object.fromEntries(
    circular
      ? data.map(
          (row, index) =>
            [
              `slice${index}`,
              { label: String(row[xKey]), color: categoryColors[index] },
            ] as const
        )
      : series.map(
          (entry, index) =>
            [entry.key, { label: entry.label, color: colors[index] }] as const
        )
  )
  const height = options?.height ?? 260
  const tip = options?.tooltip !== false && (
    <ChartTooltip
      cursor={!circular}
      content={
        <ChartTooltipContent
          nameKey={circular ? "categoryKey" : undefined}
          hideLabel={circular}
        />
      }
    />
  )
  const legend = !circular && options?.legend !== false && (
    <ChartLegend content={<ChartLegendContent />} />
  )
  const axes = options?.axes !== false
  const grid = options?.grid !== false
  const stacked =
    options?.stacking === "stacked" || options?.stacking === "percent"
  const stackOffset = options?.stacking === "percent" ? "expand" : "none"
  const axis = (
    <>
      {axes && (
        <>
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            minTickGap={16}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={36}
            tickFormatter={
              options?.stacking === "percent"
                ? (v: number) => `${Math.round(v * 100)}%`
                : undefined
            }
          />
        </>
      )}
      {grid && <CartesianGrid vertical={false} strokeDasharray="3 3" />}
    </>
  )
  const curve =
    options?.curve === "step"
      ? "step"
      : options?.curve === "natural"
        ? "natural"
        : "linear"
  const points = data.map((row, index) => ({
    label: row[xKey],
    value: row[series[0].key],
    categoryKey: `slice${index}`,
    fill: categoryColors[index],
  }))
  let chart: React.ReactElement
  if (type === "area")
    chart = (
      <AreaChart data={data} stackOffset={stackOffset}>
        {axis}
        <defs>
          {series.map((entry, index) => (
            <linearGradient
              id={`area-${gradientPrefix}-${entry.key}-${index}`}
              key={entry.key}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="5%" stopColor={colors[index]} stopOpacity={0.55} />
              <stop offset="95%" stopColor={colors[index]} stopOpacity={0.04} />
            </linearGradient>
          ))}
        </defs>
        {series.map((entry, index) => (
          <Area
            key={entry.key}
            dataKey={entry.key}
            name={entry.label}
            type={curve}
            stroke={colors[index]}
            strokeWidth={options?.lineWidth ?? 2}
            fill={
              options?.gradient
                ? `url(#area-${gradientPrefix}-${entry.key}-${index})`
                : colors[index]
            }
            fillOpacity={options?.gradient ? 1 : 0.18}
            stackId={stacked ? "total" : undefined}
          />
        ))}
        {tip}
        {legend}
      </AreaChart>
    )
  else if (type === "bar")
    chart = (
      <BarChart data={data} stackOffset={stackOffset}>
        {axis}
        {series.map((entry, index) => (
          <Bar
            key={entry.key}
            dataKey={entry.key}
            name={entry.label}
            fill={colors[index]}
            radius={[3, 3, 0, 0]}
            stackId={stacked ? "total" : undefined}
          />
        ))}
        {tip}
        {legend}
      </BarChart>
    )
  else if (type === "line")
    chart = (
      <LineChart data={data}>
        {axis}
        {series.map((entry, index) => (
          <Line
            key={entry.key}
            dataKey={entry.key}
            name={entry.label}
            type={curve}
            stroke={colors[index]}
            strokeWidth={options?.lineWidth ?? 2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
        {tip}
        {legend}
      </LineChart>
    )
  else if (type === "pie")
    chart = (
      <PieChart>
        <Pie
          data={points}
          dataKey="value"
          nameKey="categoryKey"
          innerRadius={options?.donut ? "55%" : 0}
          outerRadius="78%"
          stroke="var(--card)"
        >
          {points.map((_, index) => (
            <Cell key={index} fill={categoryColors[index]} />
          ))}
        </Pie>
        {tip}
        {legend}
      </PieChart>
    )
  else if (type === "radar")
    chart = (
      <RadarChart data={data}>
        {axes && <PolarAngleAxis dataKey={xKey} />}
        {grid && <PolarGrid />}
        {series.map((entry, index) => (
          <Radar
            key={entry.key}
            dataKey={entry.key}
            name={entry.label}
            stroke={colors[index]}
            fill={colors[index]}
            fillOpacity={0.15}
          />
        ))}
        {tip}
        {legend}
      </RadarChart>
    )
  else {
    const key = series[0].key
    const max = Math.max(1, ...data.map((row) => Number(row[key])))
    chart = (
      <RadialBarChart
        data={points}
        innerRadius="18%"
        outerRadius="92%"
        startAngle={90}
        endAngle={-270}
        barSize={14}
      >
        <PolarAngleAxis type="number" domain={[0, max]} tick={false} />
        <RadialBar
          dataKey="value"
          name={series[0].label}
          background
          cornerRadius={6}
        >
          <LabelList
            dataKey="label"
            position="insideStart"
            fill="var(--foreground)"
            fontSize={11}
          />
        </RadialBar>
        {tip}
        {legend}
      </RadialBarChart>
    )
  }
  const chartName =
    value.title ?? `${type[0].toUpperCase()}${type.slice(1)} chart`
  return (
    <figure className="bot-chart">
      <figcaption>
        {value.title && <strong>{value.title}</strong>}
        {value.subtitle && <span>{value.subtitle}</span>}
      </figcaption>
      <div className="bot-chart-scroll">
        <ChartContainer
          config={config}
          className="bot-chart-frame"
          style={{ height, minWidth: 260 }}
          role="img"
          aria-label={`${chartName}. ${value.description ?? "Data available in the table below."}`}
        >
          {chart}
        </ChartContainer>
      </div>
      {circular && options?.legend !== false && (
        <div className="bot-category-legend" aria-label="Chart categories">
          {points.map((point, index) => (
            <span key={point.categoryKey}>
              <i
                aria-hidden="true"
                style={{ backgroundColor: categoryColors[index] }}
              />
              {String(data[index][xKey])}
            </span>
          ))}
        </div>
      )}
      {value.description && (
        <p className="bot-chart-description">{value.description}</p>
      )}
      <details className="bot-chart-data">
        <summary>View chart data</summary>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{xKey}</TableHead>
              {series.map((entry) => (
                <TableHead key={entry.key}>{entry.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, index) => (
              <TableRow key={index}>
                <TableCell>{String(row[xKey])}</TableCell>
                {series.map((entry) => (
                  <TableCell key={entry.key}>
                    {String(row[entry.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </figure>
  )
}
