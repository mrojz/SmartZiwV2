export function getProjectSeedKey(project = {}) {
    return [
        project?.source || '',
        project?.project_id || '',
        project?.project_url || '',
        project?.document_url || '',
        project?.project_name || '',
        project?.project_description || '',
        project?.project_sponsor || '',
        project?.project_end_date || '',
    ].join('::');
}

export function attachProjectRowIds(items = []) {
    const seen = new Map();
    return items.map((project) => {
        if (project?.__rowId) return project;
        const seed = getProjectSeedKey(project);
        const occurrence = (seen.get(seed) || 0) + 1;
        seen.set(seed, occurrence);
        return { ...project, __rowId: `${seed}__${occurrence}` };
    });
}
