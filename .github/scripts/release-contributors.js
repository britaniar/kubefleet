const SECTION_START = "<!-- external-contributors:start -->";
const SECTION_END = "<!-- external-contributors:end -->";
const INTERNAL_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function extractPullRequestNumbers(body) {
  const numbers = new Set();
  const pattern = /\/pull\/(\d+)/g;
  for (const match of body.matchAll(pattern)) {
    numbers.add(Number(match[1]));
  }
  return [...numbers];
}

function renderSection(contributors) {
  const content =
    contributors.length === 0
      ? ""
      : [
          "## Thanks to our external contributors",
          "",
          `Thank you ${contributors.map((login) => `@${login}`).join(", ")} ` +
            "for helping improve KubeFleet!",
          "",
        ].join("\n");
  return `${SECTION_START}\n${content}${SECTION_END}`;
}

function upsertContributorSection(body, contributors) {
  const section = renderSection(contributors);
  const start = body.indexOf(SECTION_START);
  const end = body.indexOf(SECTION_END);

  if (start >= 0 && end >= start) {
    return (
      body.slice(0, start) +
      section +
      body.slice(end + SECTION_END.length)
    );
  }

  return `${body.trimEnd()}\n\n${section}`;
}

async function findExternalContributors(github, context, generatedBody) {
  const contributors = new Set();
  const pullNumbers = extractPullRequestNumbers(generatedBody);

  for (const pullNumber of pullNumbers) {
    const { data: pull } = await github.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: pullNumber,
    });
    const login = pull.user?.login;
    if (
      login &&
      !login.endsWith("[bot]") &&
      !INTERNAL_ASSOCIATIONS.has(pull.author_association)
    ) {
      contributors.add(login);
    }
  }

  return [...contributors].sort((left, right) => left.localeCompare(right));
}

async function publishRelease({ github, context, tag }) {
  const { data: generated } = await github.rest.repos.generateReleaseNotes({
    owner: context.repo.owner,
    repo: context.repo.repo,
    tag_name: tag,
  });
  const contributors = await findExternalContributors(
    github,
    context,
    generated.body,
  );

  let existing;
  try {
    const response = await github.rest.repos.getReleaseByTag({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tag,
    });
    existing = response.data;
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  if (existing) {
    await github.rest.repos.updateRelease({
      owner: context.repo.owner,
      repo: context.repo.repo,
      release_id: existing.id,
      body: upsertContributorSection(existing.body || "", contributors),
    });
  } else {
    await github.rest.repos.createRelease({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tag_name: tag,
      name: generated.name,
      body: upsertContributorSection(generated.body, contributors),
      prerelease: /(?:alpha|beta|rc)/i.test(tag),
    });
  }

  return contributors;
}

module.exports = {
  SECTION_END,
  SECTION_START,
  extractPullRequestNumbers,
  findExternalContributors,
  publishRelease,
  renderSection,
  upsertContributorSection,
};
