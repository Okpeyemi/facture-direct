export type DevisDraft = {
    id: string;
    status: string;
    titre: string | null;
    step: string | null;
    data: any; // Using any for flexibility as per original code, but could be typed stricter
    utilisateurId: string;
};
