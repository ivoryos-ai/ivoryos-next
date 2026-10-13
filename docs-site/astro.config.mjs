// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// The IvoryOS documentation: a user guide (how to use the app) and a developer guide (how to bring
// instruments, add safeguards, write plugins and work on IvoryOS itself). Built with Starlight on
// Astro: static output, built-in search, light and dark, no service behind it.

// Where the site is served. The custom domain is the default; CI (.github/workflows/docs.yml) sets
// both from what GitHub Pages reports, which is the github.io address with a sub-path until the
// custom domain is set.
const site = process.env.DOCS_SITE || 'https://docs.ivoryos.ai';
const base = process.env.DOCS_BASE || '/';

// Links written in the pages are root-absolute (`/guide/designer/`): right at the root of a domain,
// wrong under a sub-path. Starlight prefixes the base on the sidebar it generates, not on links in
// the content, so this does it for them at build time. External links and anchors are untouched.
function prefixBase() {
  const prefix = base.replace(/\/$/, '');
  return (tree) => {
    if (!prefix) return;
    const walk = (node) => {
      if (node.type === 'element' && node.tagName === 'a') {
        const href = node.properties?.href;
        if (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') && href !== prefix && !href.startsWith(`${prefix}/`)) {
          node.properties.href = prefix + href;
        }
      }
      for (const child of node.children || []) walk(child);
    };
    walk(tree);
  };
}

export default defineConfig({
  site,
  base,
  markdown: { rehypePlugins: [prefixBase] },
  integrations: [
    starlight({
      title: 'IvoryOS',
      description: 'Run your lab from one place: documentation for people who use IvoryOS and people who build on it.',
      logo: { src: './src/assets/ivoryos-mark.svg', alt: 'IvoryOS' },
      favicon: '/favicon.ico',
      customCss: ['./src/styles/custom.css'],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/ivoryzh/ivoryos-next' },
        { icon: 'discord', label: 'Discord', href: 'https://discord.gg/3KdjhUmsYA' },
        { icon: 'external', label: 'Automation Hub', href: 'https://ivoryos.ai' },
      ],
      editLink: { baseUrl: 'https://github.com/ivoryzh/ivoryos-next/edit/main/docs-site/' },
      lastUpdated: true,
      sidebar: [
        { label: 'Start here', items: [{ autogenerate: { directory: 'start' } }] },
        {
          label: 'User guide',
          items: [
            { label: 'The pages', items: [{ autogenerate: { directory: 'guide' } }] },
            { label: 'Running experiments', items: [{ autogenerate: { directory: 'run' } }] },
            { label: 'Desktop app', items: [{ autogenerate: { directory: 'desktop' } }] },
            { label: 'Cloud', collapsed: true, items: [{ autogenerate: { directory: 'cloud' } }] },
          ],
        },
        {
          label: 'Developer guide',
          items: [
            { label: 'Bring your instruments', items: [{ autogenerate: { directory: 'dev/instruments' } }] },
            { label: 'Extend IvoryOS', items: [{ autogenerate: { directory: 'dev/extend' } }] },
            { label: 'Work on IvoryOS', items: [{ autogenerate: { directory: 'dev/internals' } }] },
          ],
        },
        { label: 'Reference', collapsed: true, items: [{ autogenerate: { directory: 'reference' } }] },
      ],
    }),
  ],
});
