// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// The IvoryOS documentation: a user guide (how to use the app) and a developer guide (how to bring
// instruments, add safeguards, write plugins and work on IvoryOS itself). Built with Starlight on
// Astro: static output, built-in search, light and dark, no service behind it.
export default defineConfig({
  site: 'https://docs.ivoryos.ai',
  integrations: [
    starlight({
      title: 'IvoryOS',
      description: 'Run your lab from one place: documentation for people who use IvoryOS and people who build on it.',
      logo: { src: './src/assets/ivoryos-mark.png', alt: 'IvoryOS' },
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
