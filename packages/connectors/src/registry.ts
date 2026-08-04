import type { ConnectorDefinition, PublicConnectorDefinition } from "./definition.ts";
import { publicDefinition } from "./definition.ts";

export class ConnectorRegistry {
  private readonly definitions = new Map<string, ConnectorDefinition>();

  constructor(definitions: ConnectorDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: ConnectorDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Connector already registered: ${definition.id}`);
    }
    this.definitions.set(definition.id, definition);
  }

  get(id: string): ConnectorDefinition {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown connector: ${id}`);
    return definition;
  }

  list(): PublicConnectorDefinition[] {
    return [...this.definitions.values()].map(publicDefinition);
  }
}
