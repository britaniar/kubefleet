const SLA_START_MARKER = "external-contribution-sla-start";
const SLA_ALERT_MARKER = "external-contribution-sla-alert";
const INTERNAL_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function isExternalAssociation(association) {
  return !INTERNAL_ASSOCIATIONS.has(association);
}

function isBot(user) {
  return user?.type === "Bot" || user?.login?.endsWith("[bot]");
}

function addBusinessDays(start, businessDays) {
  const deadline = new Date(start);
  let added = 0;

  while (added < businessDays) {
    deadline.setUTCDate(deadline.getUTCDate() + 1);
    const day = deadline.getUTCDay();
    if (day !== 0 && day !== 6) {
      added += 1;
    }
  }

  return deadline;
}

function hasLabel(item, labelName) {
  return item.labels.some((label) => {
    const name = typeof label === "string" ? label : label.name;
    return name === labelName;
  });
}

async function ensureLabel(github, context, label) {
  try {
    await github.rest.issues.createLabel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ...label,
    });
  } catch (error) {
    if (error.status !== 422) {
      throw error;
    }
  }
}

async function addLabel(github, context, issueNumber, labelName) {
  await github.rest.issues.addLabels({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
    labels: [labelName],
  });
}

async function removeLabel(github, context, issueNumber, labelName) {
  try {
    await github.rest.issues.removeLabel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      name: labelName,
    });
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }
}

function welcomeBody(author, startedAt, businessDays) {
  return [
    `<!-- ${SLA_START_MARKER}:${startedAt} -->`,
    `Thank you for contributing, @${author}!`,
    "",
    `A maintainer aims to provide an initial response within ${businessDays} business days.`,
  ].join("\n");
}

async function handleIntake({ github, context, config }) {
  const item = context.payload.issue || context.payload.pull_request;
  if (
    !item ||
    item.draft ||
    isBot(item.user) ||
    !isExternalAssociation(item.author_association)
  ) {
    return;
  }

  const externalLabel = config.labels.external;
  await ensureLabel(github, context, externalLabel);

  const current = await github.rest.issues.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: item.number,
  });
  if (!hasLabel(current.data, externalLabel.name)) {
    await addLabel(github, context, item.number, externalLabel.name);
  }

  const comments = await listComments(github, context, item.number);
  if (findMarkerTimestamp(comments, SLA_START_MARKER)) {
    return;
  }

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: item.number,
    body: welcomeBody(
      item.user.login,
      new Date().toISOString(),
      config.slaBusinessDays,
    ),
  });
}

async function handleResponse({ github, context, config }) {
  const response = context.payload.comment || context.payload.review;
  const item = context.payload.issue || context.payload.pull_request;
  if (!response || !item || !INTERNAL_ASSOCIATIONS.has(response.author_association)) {
    return;
  }

  const current = await github.rest.issues.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: item.number,
  });
  if (!hasLabel(current.data, config.labels.external.name)) {
    return;
  }

  await removeLabel(
    github,
    context,
    item.number,
    config.labels.overdue.name,
  );
}

function findMarkerTimestamp(comments, marker) {
  const pattern = new RegExp(`<!--\\s*${marker}:([^\\s]+)\\s*-->`);
  for (const comment of comments) {
    const match = comment.body?.match(pattern);
    if (match) {
      return new Date(match[1]);
    }
  }
  return undefined;
}

function hasAlertMarker(comments) {
  return comments.some((comment) =>
    comment.body?.includes(`<!-- ${SLA_ALERT_MARKER} -->`),
  );
}

function isInternalResponse(response, startedAt) {
  return (
    INTERNAL_ASSOCIATIONS.has(response.author_association) &&
    new Date(response.created_at || response.submitted_at) >= startedAt
  );
}

async function listComments(github, context, issueNumber) {
  return github.paginate(github.rest.issues.listComments, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
    per_page: 100,
  });
}

async function hasMaintainerResponse(
  github,
  context,
  item,
  comments,
  startedAt,
) {
  if (comments.some((comment) => isInternalResponse(comment, startedAt))) {
    return true;
  }
  if (!item.pull_request) {
    return false;
  }

  const reviews = await github.paginate(github.rest.pulls.listReviews, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: item.number,
    per_page: 100,
  });
  return reviews.some((review) => isInternalResponse(review, startedAt));
}

function alertBody(config, deadline) {
  return [
    `<!-- ${SLA_ALERT_MARKER} -->`,
    `${config.maintainerMention}, this external contribution has passed the ` +
      `${config.slaBusinessDays}-business-day first-response SLA.`,
    "",
    `SLA deadline: ${deadline.toISOString()}`,
  ].join("\n");
}

async function checkSla({
  github,
  context,
  config,
  now = new Date(),
}) {
  for (const label of Object.values(config.labels)) {
    await ensureLabel(github, context, label);
  }

  const items = await github.paginate(github.rest.issues.listForRepo, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    state: "open",
    labels: config.labels.external.name,
    per_page: 100,
  });
  const alerts = [];

  for (const item of items) {
    const comments = await listComments(github, context, item.number);
    const startedAt =
      findMarkerTimestamp(comments, SLA_START_MARKER) ||
      new Date(item.created_at);
    const responded = await hasMaintainerResponse(
      github,
      context,
      item,
      comments,
      startedAt,
    );

    if (responded) {
      if (hasLabel(item, config.labels.overdue.name)) {
        await removeLabel(
          github,
          context,
          item.number,
          config.labels.overdue.name,
        );
      }
      continue;
    }

    const deadline = addBusinessDays(startedAt, config.slaBusinessDays);
    if (now < deadline) {
      continue;
    }

    await addLabel(github, context, item.number, config.labels.overdue.name);

    if (hasAlertMarker(comments)) {
      continue;
    }

    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: item.number,
      body: alertBody(config, deadline),
    });
    alerts.push({
      kind: item.pull_request ? "PR" : "Issue",
      number: item.number,
      title: item.title,
      url: item.html_url,
    });
  }

  return alerts;
}

module.exports = {
  SLA_ALERT_MARKER,
  SLA_START_MARKER,
  addBusinessDays,
  checkSla,
  findMarkerTimestamp,
  handleIntake,
  handleResponse,
  isBot,
  isExternalAssociation,
};
