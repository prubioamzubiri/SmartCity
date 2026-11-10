export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k.startsWith('aria-') || k.startsWith('data-') || k === 'role') node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of children) node.append(c);
  return node;
}
