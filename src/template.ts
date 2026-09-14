const specialCharacters = /[.*+?^${}()|[\]\\]/g;

export interface Template {
  /** Substitute `{name}` placeholders literally. */
  render(values: Record<string, string>): string;
  /** Test `name` against the template as an anchored regular expression. */
  matches(name: string, values: Record<string, string>): boolean;
}

export function template(source: string): Template {
  function render(values: Record<string, string>): string {
    let rendered = source;
    for (const [name, value] of Object.entries(values)) {
      rendered = rendered.replaceAll(`{${name}}`, value);
    }

    return rendered;
  }

  return {
    render,
    matches(name, values) {
      const literals = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          value.replaceAll(specialCharacters, "\\$&"),
        ]),
      );

      return new RegExp(`^${render(literals)}$`).test(name);
    },
  };
}
