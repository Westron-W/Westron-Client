const englishTitleCollator = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });

function filterAndSortByEnglishPrefix(projects, query) {
  const firstLetter = query.trim().slice(0, 1).toLocaleLowerCase('en-US');
  if (!firstLetter) return projects;
  if (!/^[a-z]$/.test(firstLetter)) return [];

  return projects
    .filter((project) => typeof project.title === 'string'
      && project.title.trim().toLocaleLowerCase('en-US').startsWith(firstLetter))
    .sort((left, right) => englishTitleCollator.compare(left.title, right.title)
      || String(left.project_id ?? left.id ?? '').localeCompare(String(right.project_id ?? right.id ?? ''), 'en-US'));
}

module.exports = { filterAndSortByEnglishPrefix };
