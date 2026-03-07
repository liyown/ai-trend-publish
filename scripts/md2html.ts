import { renderMarkdown } from "jsr:@sapling/markdown";
import { walk } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { basename, join } from "https://deno.land/std@0.224.0/path/mod.ts";

interface DocEntry {
  title: string;
  url: string;
  path: string;
}

const BASE_URL = "https://liyown.github.io/ai-trend-publish";
const DOCS_INDEX: DocEntry[] = [];

// HTML 模板
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{title}} - AI Trend Publish</title>
    <style>
        :root {
            --primary-color: #2563eb;
            --text-color: #1f2937;
            --bg-color: #ffffff;
            --nav-bg: #f3f4f6;
            --code-bg: #282c34;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        html, body {
            height: 100%;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            color: var(--text-color);
            background: var(--bg-color);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .container {
            display: flex;
            flex: 1;
            height: 100vh;
            width: 100%;
            margin: 0;
            padding: 0;
            position: relative;
        }

        .nav-toggle {
            display: none;
            position: fixed;
            top: 1rem;
            right: 1rem;
            z-index: 1000;
            background: var(--primary-color);
            color: white;
            border: none;
            padding: 0.5rem;
            border-radius: 4px;
            cursor: pointer;
            width: 40px;
            height: 40px;
        }

        .nav-toggle span {
            display: block;
            width: 20px;
            height: 2px;
            background: white;
            margin: 4px auto;
            transition: all 0.3s;
        }
        
        nav {
            width: 280px;
            height: 100vh;
            padding: 2rem 1.5rem;
            background: var(--nav-bg);
            border-right: 1px solid #e5e7eb;
            position: fixed;
            left: 0;
            top: 0;
            overflow-y: auto;
            transition: transform 0.3s ease;
            z-index: 100;
        }
        
        main {
            flex: 1;
            padding: 2rem 3rem;
            margin-left: 280px;
            max-width: 100%;
            overflow-y: auto;
            min-height: 100vh;
        }
        
        h1 {
            font-size: 2rem;
            margin: 1rem 0 1.5rem 0;
            color: var(--primary-color);
        }
        
        h2 {
            font-size: 1.5rem;
            margin: 1.5rem 0 1rem 0;
            color: var(--text-color);
        }
        
        h3, h4, h5, h6 {
            margin: 1rem 0;
            color: var(--text-color);
        }
        
        p {
            margin: 1rem 0;
        }
        
        a {
            color: var(--primary-color);
            text-decoration: none;
            transition: color 0.2s;
        }
        
        a:hover {
            text-decoration: underline;
            color: #1d4ed8;
        }
        
        nav ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        
        nav li {
            margin: 0.75rem 0;
            padding: 0.25rem 0;
        }
        
        nav a {
            display: block;
            padding: 0.5rem;
            border-radius: 4px;
            transition: all 0.2s;
        }
        
        nav a:hover {
            background: rgba(37, 99, 235, 0.1);
            text-decoration: none;
        }
        
        pre {
            background: var(--code-bg);
            padding: 1rem;
            border-radius: 8px;
            overflow-x: auto;
            margin: 1.5rem 0;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        
        code {
            font-family: "JetBrains Mono", Consolas, Monaco, "Andale Mono", monospace;
            font-size: 0.9em;
        }
        
        :not(pre) > code {
            background: #f3f4f6;
            padding: 0.2em 0.4em;
            border-radius: 4px;
            color: #e06c75;
        }
        
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 1.5rem 0;
            background: white;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
            border-radius: 8px;
            overflow: hidden;
        }
        
        th, td {
            border: 1px solid #e5e7eb;
            padding: 0.75rem 1rem;
            text-align: left;
        }
        
        th {
            background: var(--nav-bg);
            font-weight: 600;
        }
        
        tr:nth-child(even) {
            background: #f9fafb;
        }
        
        img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
            margin: 1rem 0;
        }
        
        blockquote {
            border-left: 4px solid var(--primary-color);
            margin: 1.5rem 0;
            padding: 1rem 1.5rem;
            background: var(--nav-bg);
            border-radius: 0 8px 8px 0;
        }
        
        ul, ol {
            margin: 1rem 0;
            padding-left: 1.5rem;
        }
        
        li {
            margin: 0.5rem 0;
        }
        
        hr {
            border: none;
            border-top: 1px solid #e5e7eb;
            margin: 2rem 0;
        }
        
        @media (max-width: 768px) {
            .nav-toggle {
                display: block;
            }
            
            nav {
                width: 100%;
                max-width: 300px;
                transform: translateX(-100%);
            }
            
            nav.active {
                transform: translateX(0);
            }
            
            main {
                margin-left: 0;
                padding: 1rem;
            }

            .nav-toggle.active span:nth-child(1) {
                transform: rotate(45deg) translate(5px, 5px);
            }

            .nav-toggle.active span:nth-child(2) {
                opacity: 0;
            }

            .nav-toggle.active span:nth-child(3) {
                transform: rotate(-45deg) translate(5px, -5px);
            }

            h1 {
                font-size: 1.75rem;
                margin: 0.75rem 0 1rem 0;
            }

            h2 {
                font-size: 1.35rem;
            }

            pre {
                margin: 1rem -1rem;
                border-radius: 0;
            }

            blockquote {
                margin: 1rem -1rem;
                border-radius: 0;
            }

            table {
                display: block;
                overflow-x: auto;
                white-space: nowrap;
            }
        }
    </style>
</head>
<body>
    <button class="nav-toggle" aria-label="切换导航菜单">
        <span></span>
        <span></span>
        <span></span>
    </button>
    <div class="container">
        <nav>
            <h1>文档导航</h1>
            <ul>
                {{navigation}}
            </ul>
        </nav>
        <main>
            {{content}}
        </main>
    </div>
    <script>
        // 移动端导航切换
        const navToggle = document.querySelector('.nav-toggle');
        const nav = document.querySelector('nav');
        
        navToggle.addEventListener('click', () => {
            nav.classList.toggle('active');
            navToggle.classList.toggle('active');
        });

        // 点击导航链接时自动关闭导航菜单
        document.querySelectorAll('nav a').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    nav.classList.remove('active');
                    navToggle.classList.remove('active');
                }
            });
        });

        // 点击内容区域时关闭导航菜单
        document.querySelector('main').addEventListener('click', () => {
            if (window.innerWidth <= 768 && nav.classList.contains('active')) {
                nav.classList.remove('active');
                navToggle.classList.remove('active');
            }
        });
    </script>
</body>
</html>`;

async function convertMdToHtml(mdPath: string): Promise<void> {
  try {
    // 读取 Markdown 文件
    const markdown = await Deno.readTextFile(mdPath);

    // 转换 Markdown 为 HTML，使用 one-dark-pro 主题
    const content = await renderMarkdown(markdown, {
      shikiOptions: {
        theme: "one-dark-pro",
      },
    });

    // 生成输出文件路径
    const fileName = basename(mdPath).replace(".md", ".html");
    const outputPath = join("./docs", fileName);

    // 提取标题
    const title = await extractTitle(markdown) || fileName.replace(".html", "");

    // 添加到文档索引
    DOCS_INDEX.push({
      title,
      url: `${BASE_URL}/${fileName}`,
      path: outputPath,
    });

    // 生成导航链接
    const navigation = DOCS_INDEX.map((doc) =>
      `<li><a href="${doc.url}">${doc.title}</a></li>`
    ).join("\n");

    // 应用模板
    const html = HTML_TEMPLATE
      .replace("{{title}}", title)
      .replace("{{navigation}}", navigation)
      .replace("{{content}}", content);

    // 写入 HTML 文件
    await Deno.writeTextFile(outputPath, html);

    console.log(`✅ 已转换: ${mdPath} -> ${outputPath}`);
  } catch (error) {
    console.error(`❌ 转换失败 ${mdPath}:`, error);
  }
}

async function extractTitle(markdown: string): Promise<string | null> {
  // 尝试从 Markdown 中提取第一个标题
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  return titleMatch ? titleMatch[1].trim() : null;
}

async function generateDocsIndex(): Promise<void> {
  const indexContent = `# 帮助文档

以下是所有可用的文档链接：

${DOCS_INDEX.map((doc) => `- [${doc.title}](${doc.url})`).join("\n")}
`;

  // 转换为 HTML，使用 one-dark-pro 主题
  const content = await renderMarkdown(indexContent, {
    shikiOptions: {
      theme: "one-dark-pro",
    },
  });

  // 生成导航链接
  const navigation = DOCS_INDEX.map((doc) =>
    `<li><a href="${doc.url}">${doc.title}</a></li>`
  ).join("\n");

  // 应用模板
  const html = HTML_TEMPLATE
    .replace("{{title}}", "帮助文档")
    .replace("{{navigation}}", navigation)
    .replace("{{content}}", content);

  await Deno.writeTextFile("./docs/help.html", html);
  console.log("📚 帮助文档已生成到 help.html");
}

async function main() {
  const mdDir = "./docs/md";

  try {
    // 遍历 md 目录下的所有 .md 文件
    for await (const entry of walk(mdDir, { exts: [".md"] })) {
      if (entry.isFile && !entry.path.endsWith("index.md")) {
        await convertMdToHtml(entry.path);
      }
    }

    // 生成文档索引
    await generateDocsIndex();

    console.log("🎉 所有文件转换完成！");
  } catch (error) {
    console.error("转换过程中出错:", error);
  }
}

if (import.meta.main) {
  main();
}
