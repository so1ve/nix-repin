export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  for (const [name, value] of Object.entries(values)) {
    template = template.replaceAll(`{${name}}`, value);
  }

  return template;
}
