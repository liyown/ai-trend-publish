export function formatDate(dateString: string): string {
  // 尝试多种方式解析日期
  let date: Date;
  try {
    // 首先尝试直接解析
    date = new Date(dateString);

    // 检查是否为有效日期
    if (isNaN(date.getTime())) {
      // 尝试处理特殊格式
      if (dateString.includes("+")) {
        // 处理带时区的格式
        date = new Date(dateString.replace(/(\+\d{4})/, "UTC$1"));
      } else {
        // 尝试移除特殊字符后解析
        const cleanDate = dateString.replace(/[^\d\s:-]/g, "");
        date = new Date(cleanDate);
      }
    }

    if (isNaN(date.getTime())) {
      throw new Error("Invalid date");
    }
  } catch (error) {
    throw new Error(`Unable to parse date: ${dateString}`, { cause: error });
  }

  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");

  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function normalizeToken(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function extractPrimaryAuthorSurname(author: string): string {
  const firstAuthor = author
    .split(/\band\b|;|\s+et\s+al\.?/i)
    .map((part) => part.trim())
    .filter(Boolean)[0] ?? "ref";

  // 保留逗号前的主要姓名片段，例如 "Li S, Yang B, Hu J" -> "Li S"
  const primaryName = firstAuthor.split(",")[0]?.trim() || firstAuthor;
  const nameParts = primaryName.split(/\s+/).filter(Boolean);

  if (nameParts.length === 0) {
    return "ref";
  }

  if (nameParts.length === 1) {
    return normalizeToken(nameParts[0]);
  }

  // Google Scholar 常见格式: "Li S" / "Smith J"（姓在前，名缩写在后）
  if (/^[A-Z]([.-]?[A-Z])*$/i.test(nameParts[nameParts.length - 1])) {
    return normalizeToken(nameParts[0]);
  }

  // 常见格式: "John Smith"（姓在后）
  return normalizeToken(nameParts[nameParts.length - 1]);
}

/**
 * 生成更稳定的 LaTeX/BibTeX 引用 key，格式：{firstAuthorLastName}{year}{firstMeaningfulWord}
 * 例如：Li + 2011 + Performance => li2011performance
 */
export function buildLatexCitationKey(
  author: string,
  year: string | number,
  title: string,
): string {
  const yearText = String(year).match(/\d{4}/)?.[0] ?? String(year);
  const authorToken = extractPrimaryAuthorSurname(author);

  const stopWords = new Set(["a", "an", "the", "of", "on", "for", "and", "in", "to"]);
  const titleWords = title
    .split(/\s+/)
    .map((word) => normalizeToken(word))
    .filter(Boolean);
  const firstMeaningfulWord =
    titleWords.find((word) => !stopWords.has(word)) ?? titleWords[0] ?? "paper";

  return `${authorToken || "ref"}${yearText}${firstMeaningfulWord}`;
}
