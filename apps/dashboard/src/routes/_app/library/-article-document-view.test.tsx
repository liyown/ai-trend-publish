import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vite-plus/test";
import { ArticleDocumentView } from "./-article-document-view.tsx";

test("legacy escaped quote markup renders as readable emphasized text", () => {
  const html = renderToStaticMarkup(
    <ArticleDocumentView
      document={
        {
          root: {
            id: "root",
            type: "root",
            children: [
              {
                id: "paragraph",
                type: "paragraph",
                children: [
                  { id: "before", type: "text", text: "共同主题是**&quot;更便宜&quot;" },
                  {
                    id: "connector",
                    type: "strong",
                    children: [{ id: "connector-text", type: "text", text: "以及" }],
                  },
                  { id: "after", type: "text", text: "&quot;更可靠&quot;**。" },
                ],
              },
            ],
          },
        } as never
      }
      assets={[]}
      evidence={[]}
      materials={[]}
    />,
  );

  expect(html).toContain("&quot;更便宜&quot;");
  expect(html).toContain("以及<strong");
  expect(html).toContain("&quot;更可靠&quot;");
  expect(html).not.toContain("**");
  expect(html).not.toContain("&amp;quot;");
});
