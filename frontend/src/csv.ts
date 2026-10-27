export function downloadCsv(headers: string[], rows: Array<Array<string | number | null>>, filename: string) {
  const cell = (value: string | number | null) => {
    const text = String(value ?? "");
    const safe = typeof value === "string" && /^[=+@-]/.test(text) ? `\t${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
