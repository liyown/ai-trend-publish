declare module "marked" {
  export class Renderer {
    [method: string]: unknown;
  }

  interface MarkedOptions {
    renderer?: Partial<Renderer>;
  }

  interface MarkedStatic {
    (markdown: string, options?: MarkedOptions): string;
    parse(markdown: string, options?: MarkedOptions): string;
    use(options: MarkedOptions): void;
  }

  export const marked: MarkedStatic;
}

export {};
