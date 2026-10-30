export const sortByCreatedDate = <T extends { created: string }>(a: T, b: T) => {
	return new Date(b.created).getTime() - new Date(a.created).getTime();
};
