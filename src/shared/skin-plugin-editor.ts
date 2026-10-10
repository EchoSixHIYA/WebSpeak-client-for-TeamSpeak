import {
  SKIN_PLUGIN_HOST_WIDGET_PERMISSIONS,
  parseSkinPluginDocument,
  type SkinPluginComponent,
  type SkinPluginDocument,
  type SkinPluginNode,
} from "./skin-plugin.js";

/** Normalize an older declarative package before editing while preserving its validated data. */
export function editableSkinPluginDocument(input: unknown): SkinPluginDocument {
  // The package parser materializes the schema-v1 default `mode: "widget"` in
  // its normalized object. Remove that derived field before validating the
  // normalized document again, since schema v1 itself does not declare mode.
  const source = input && typeof input === "object" && !Array.isArray(input)
    && (input as { schemaVersion?: unknown }).schemaVersion === 1
    && Array.isArray((input as { components?: unknown }).components)
    ? {
      ...(input as Record<string, unknown>),
      components: ((input as { components: unknown[] }).components).map((component) => {
        if (!component || typeof component !== "object" || Array.isArray(component)
          || (component as { mode?: unknown }).mode !== "widget") return component;
        const withoutDefaultMode = { ...(component as Record<string, unknown>) };
        delete withoutDefaultMode.mode;
        return withoutDefaultMode;
      }),
    }
    : input;
  const parsed = parseSkinPluginDocument(source);
  if (parsed.schemaVersion === 3) return parsed;
  const components = parsed.components.map((component) => {
    const permissions = new Set(component.permissions);
    const visit = (node: SkinPluginNode) => {
      if (node.widget) SKIN_PLUGIN_HOST_WIDGET_PERMISSIONS[node.widget]?.forEach((permission) => permissions.add(permission));
      node.children?.forEach(visit);
    };
    visit(component.root);
    return { ...component, permissions: [...permissions] };
  });
  return parseSkinPluginDocument({ schemaVersion: 3, components });
}

export function assertSkinPluginAuthoringDocument(input: unknown): SkinPluginDocument {
  const document = editableSkinPluginDocument(input);
  const visit = (node: SkinPluginNode) => {
    const reserved = Object.keys(node.attributes ?? {}).find((key) => key.startsWith("data-ws-"));
    if (reserved) throw new Error("The " + reserved + " attribute is owned by WebSpeak and cannot be authored by a skin.");
    node.children?.forEach(visit);
  };
  document.components.forEach((component) => visit(component.root));
  return document;
}

function checked(input: unknown): SkinPluginDocument {
  return editableSkinPluginDocument(input);
}

function componentIndex(document: SkinPluginDocument, id: string): number {
  const index = document.components.findIndex((component) => component.id === id);
  if (index < 0) throw new Error("The skin component no longer exists.");
  return index;
}

function parentNode(component: SkinPluginComponent, path: readonly number[]): SkinPluginNode {
  if (!path.length) return component.root;
  let current = component.root;
  for (const index of path) {
    const child = current.children?.[index];
    if (!child) throw new Error("The selected node no longer exists.");
    current = child;
  }
  return current;
}

function nodeAt(component: SkinPluginComponent, path: readonly number[]): SkinPluginNode {
  return parentNode(component, path);
}

function assertChildIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) throw new Error("The selected node no longer exists.");
}

function updateTree(
  input: SkinPluginDocument,
  componentId: string,
  update: (component: SkinPluginComponent) => SkinPluginComponent,
): SkinPluginDocument {
  const document = editableSkinPluginDocument(input);
  const index = componentIndex(document, componentId);
  const components = [...document.components];
  components[index] = update(components[index]);
  return checked({ schemaVersion: 3, components });
}

export function addSkinPluginComponent(input: SkinPluginDocument, component: unknown): SkinPluginDocument {
  const document = editableSkinPluginDocument(input);
  return checked({ schemaVersion: 3, components: [...document.components, component] });
}

export function replaceSkinPluginComponent(input: SkinPluginDocument, componentId: string, component: unknown): SkinPluginDocument {
  return updateTree(input, componentId, () => component as SkinPluginComponent);
}

export function removeSkinPluginComponent(input: SkinPluginDocument, componentId: string): SkinPluginDocument {
  const document = editableSkinPluginDocument(input);
  componentIndex(document, componentId);
  return checked({ schemaVersion: 3, components: document.components.filter((component) => component.id !== componentId) });
}

export function moveSkinPluginComponent(
  input: SkinPluginDocument,
  componentId: string,
  direction: -1 | 1,
): SkinPluginDocument {
  const document = editableSkinPluginDocument(input);
  const from = componentIndex(document, componentId);
  const to = from + direction;
  if (to < 0 || to >= document.components.length) return document;
  const components = [...document.components];
  [components[from], components[to]] = [components[to], components[from]];
  return checked({ schemaVersion: 3, components });
}

export function addSkinPluginNode(
  input: SkinPluginDocument,
  componentId: string,
  parentPath: readonly number[],
  node: unknown,
): SkinPluginDocument {
  return updateTree(input, componentId, (component) => {
    const parent = nodeAt(component, parentPath);
    if (!parent.tag) throw new Error("Only element nodes can contain children.");
    const children = [...(parent.children ?? []), node as SkinPluginNode];
    return { ...component, root: replaceNodeAtPath(component.root, parentPath, { ...parent, children }) };
  });
}

export function addSkinPluginNodeSibling(
  input: SkinPluginDocument,
  componentId: string,
  path: readonly number[],
  node: unknown,
): SkinPluginDocument {
  if (!path.length) throw new Error("A component root cannot have siblings.");
  return updateTree(input, componentId, (component) => {
    const parentPath = path.slice(0, -1);
    const parent = nodeAt(component, parentPath);
    if (!parent.tag) throw new Error("Only element nodes can contain children.");
    const index = path[path.length - 1];
    const children = [...(parent.children ?? [])];
    assertChildIndex(index, children.length);
    children.splice(index + 1, 0, node as SkinPluginNode);
    return { ...component, root: replaceNodeAtPath(component.root, parentPath, { ...parent, children }) };
  });
}

export function replaceSkinPluginNode(
  input: SkinPluginDocument,
  componentId: string,
  path: readonly number[],
  node: unknown,
): SkinPluginDocument {
  return updateTree(input, componentId, (component) => ({
    ...component,
    root: replaceNodeAtPath(component.root, path, node as SkinPluginNode),
  }));
}

export function removeSkinPluginNode(input: SkinPluginDocument, componentId: string, path: readonly number[]): SkinPluginDocument {
  if (!path.length) throw new Error("A component root cannot be removed; delete the component instead.");
  return updateTree(input, componentId, (component) => {
    const parentPath = path.slice(0, -1);
    const parent = nodeAt(component, parentPath);
    const index = path[path.length - 1];
    const children = [...(parent.children ?? [])];
    assertChildIndex(index, children.length);
    children.splice(index, 1);
    return { ...component, root: replaceNodeAtPath(component.root, parentPath, { ...parent, children }) };
  });
}

export function moveSkinPluginNode(
  input: SkinPluginDocument,
  componentId: string,
  path: readonly number[],
  direction: -1 | 1,
): SkinPluginDocument {
  if (!path.length) throw new Error("A component root cannot be reordered.");
  return updateTree(input, componentId, (component) => {
    const parentPath = path.slice(0, -1);
    const parent = nodeAt(component, parentPath);
    const children = [...(parent.children ?? [])];
    const from = path[path.length - 1];
    const to = from + direction;
    assertChildIndex(from, children.length);
    if (from < 0 || from >= children.length || to < 0 || to >= children.length) return component;
    [children[from], children[to]] = [children[to], children[from]];
    return { ...component, root: replaceNodeAtPath(component.root, parentPath, { ...parent, children }) };
  });
}

export function replaceNodeAtPath(root: SkinPluginNode, path: readonly number[], replacement: SkinPluginNode): SkinPluginNode {
  if (!path.length) return replacement;
  const [index, ...rest] = path;
  const children = [...(root.children ?? [])];
  assertChildIndex(index, children.length);
  children[index] = replaceNodeAtPath(children[index], rest, replacement);
  return { ...root, children };
}

export function getSkinPluginNode(input: SkinPluginDocument, componentId: string, path: readonly number[]): SkinPluginNode {
  const document = editableSkinPluginDocument(input);
  return nodeAt(document.components[componentIndex(document, componentId)], path);
}

/** Give a duplicated subtree fresh stable layout parts so it cannot alias its source nodes. */
export function duplicateSkinPluginNode(input: SkinPluginDocument, componentId: string, path: readonly number[]): SkinPluginNode {
  if (!path.length) throw new Error("A component root cannot be duplicated.");
  const document = editableSkinPluginDocument(input);
  const component = document.components[componentIndex(document, componentId)];
  const source = nodeAt(component, path);
  const usedParts = new Set<string>();
  const exclude = (node: SkinPluginNode, currentPath: readonly number[]): void => {
    if (currentPath.length === path.length && currentPath.every((index, position) => index === path[position])) return;
    if (node.part) usedParts.add(node.part);
    node.children?.forEach((child, index) => exclude(child, [...currentPath, index]));
  };
  exclude(component.root, []);

  const copy = JSON.parse(JSON.stringify(source)) as SkinPluginNode;
  const refreshParts = (node: SkinPluginNode): void => {
    if (node.part) {
      const stem = node.part.slice(0, 54) + "-copy";
      let candidate = stem;
      let suffix = 2;
      while (usedParts.has(candidate)) {
        const tail = "-" + suffix++;
        candidate = stem.slice(0, 64 - tail.length) + tail;
      }
      node.part = candidate;
      usedParts.add(candidate);
    }
    node.children?.forEach(refreshParts);
  };
  refreshParts(copy);
  return copy;
}
