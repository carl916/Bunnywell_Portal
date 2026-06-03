export type SnagStatus = "Open" | "Pending" | "Resolved";
export type UserRole = "admin" | "user";

export type Flat = {
  id: string;
  flatReference: string;
  buildingName: string;
};

export type Snag = {
  id: string;
  flatId: string;
  title: string;
  description: string;
  status: SnagStatus;
  priority: 1 | 2 | 3;
  createdAt: string;
  createdBy: string;
  imageDataUrl?: string;
  imagePath?: string;
};

export const flats: Flat[] = [1, 2, 3].flatMap((floor) =>
  Array.from({ length: 10 }, (_, index) => {
    const flatReference = `${floor}${String(index + 1).padStart(2, "0")}`;

    return {
      id: `forum-house-${flatReference}`,
      flatReference,
      buildingName: "Forum House",
    };
  }),
);

export const demoSnags: Snag[] = [
  {
    id: "snag-demo-1",
    flatId: "forum-house-101",
    title: "Loose handle on balcony door",
    description: "Handle feels unstable when opening and closing.",
    status: "Open",
    priority: 2,
    createdAt: "2026-06-02T10:30:00.000Z",
    createdBy: "Demo User",
  },
  {
    id: "snag-demo-2",
    flatId: "forum-house-205",
    title: "Paint scuff beside entrance",
    description: "Visible scuffing on the hallway wall near the front door.",
    status: "Pending",
    priority: 3,
    createdAt: "2026-06-02T11:15:00.000Z",
    createdBy: "Demo User",
  },
  {
    id: "snag-demo-3",
    flatId: "forum-house-309",
    title: "Kitchen cupboard alignment",
    description: "Upper cupboard doors are not aligned evenly.",
    status: "Resolved",
    priority: 1,
    createdAt: "2026-06-02T12:05:00.000Z",
    createdBy: "Site Admin",
  },
];
