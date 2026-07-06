const { GH_TOKEN, GIST_ID, TIMEZONE = 'Asia/Seoul' } = process.env;

if (!GH_TOKEN) throw new Error('GH_TOKEN is not provided.');
if (!GIST_ID) throw new Error('GIST_ID is not provided.');

const gql = async (query) => {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${GH_TOKEN}` },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
};

/** clone from https://github.com/matchai/waka-box */
const bar = (percent, size) => {
  const syms = '░▏▎▍▌▋▊▉█';
  const frac = Math.floor((size * 8 * percent) / 100);
  const full = Math.floor(frac / 8);
  if (full >= size) return syms[8].repeat(size);
  const semi = frac % 8;
  return (syms[8].repeat(full) + syms[semi]).padEnd(size, syms[0]);
};

const BAR = 16; // bar width — keeps the card narrow

(async () => {
  const { viewer } = await gql(`query { viewer { login id } }`);
  const { login, id } = viewer;

  const repoData = await gql(`query {
    user(login: "${login}") {
      repositoriesContributedTo(last: 100, includeUserRepositories: true) {
        nodes { isFork name owner { login } }
      }
    }
  }`);
  const repos = repoData.user.repositoriesContributedTo.nodes
    .filter((r) => !r.isFork)
    .map((r) => ({ name: r.name, owner: r.owner.login }));

  let morning = 0, daytime = 0, evening = 0, night = 0;
  await Promise.all(
    repos.map(async ({ name, owner }) => {
      const d = await gql(`query {
        repository(owner: "${owner}", name: "${name}") {
          defaultBranchRef { target { ... on Commit {
            history(first: 100, author: { id: "${id}" }) {
              edges { node { committedDate } }
            }
          } } }
        }
      }`);
      const edges = d.repository?.defaultBranchRef?.target?.history?.edges ?? [];
      for (const e of edges) {
        const hour =
          +new Date(e.node.committedDate)
            .toLocaleTimeString('en-US', { hour12: false, timeZone: TIMEZONE })
            .split(':')[0] % 24;
        if (hour >= 6 && hour < 12) morning++;
        else if (hour >= 12 && hour < 18) daytime++;
        else if (hour >= 18 && hour < 24) evening++;
        else night++;
      }
    }),
  );

  const timeSum = morning + daytime + evening + night || 1;
  const timeRows = [
    { label: '🌞 Morning', n: morning },
    { label: '🌆 Daytime', n: daytime },
    { label: '🌃 Evening', n: evening },
    { label: '🌙 Night', n: night },
  ];
  const timeLines = timeRows.map((r) => {
    const p = (r.n / timeSum) * 100;
    return `${r.label.padEnd(10)} ${bar(p, BAR)} ${p.toFixed(1).padStart(5)}%`;
  });

  const langData = await gql(`query {
    viewer {
      repositories(first: 100, ownerAffiliations: [OWNER], isFork: false) {
        nodes {
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name } }
          }
        }
      }
    }
  }`);
  const langBytes = {};
  for (const repo of langData.viewer.repositories.nodes) {
    for (const e of repo.languages.edges) {
      langBytes[e.node.name] = (langBytes[e.node.name] || 0) + e.size;
    }
  }
  const totalBytes = Object.values(langBytes).reduce((a, b) => a + b, 0) || 1;
  const topLangs = Object.entries(langBytes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, size]) => ({ name, percent: (size / totalBytes) * 100 }));

  const langLines = topLangs.map(
    (l) => `${l.name.padEnd(10)} ${bar(l.percent, BAR)} ${l.percent.toFixed(1).padStart(5)}%`,
  );

  const content = [...timeLines, '', ...langLines].join('\n');

  const owl = morning + daytime > evening + night ? '🐤 early bird' : '🦉 night owl';
  const title = `${owl} · mostly ${topLangs[0]?.name ?? 'code'}`;

  const gist = await (
    await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Authorization: `bearer ${GH_TOKEN}` },
    })
  ).json();
  if (!gist.files) throw new Error(`cannot read gist: ${JSON.stringify(gist)}`);
  const filename = Object.keys(gist.files)[0];

  const patch = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: { Authorization: `bearer ${GH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: { [filename]: { filename: title, content } } }),
  });
  if (!patch.ok) throw new Error(`gist update failed: ${patch.status} ${await patch.text()}`);

  console.log(`updated gist ✅\n${title}\n${content}`);
})();
