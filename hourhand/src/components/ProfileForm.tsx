"use client";

import { useActionState } from "react";
import { removePhotoAction, saveProfileAction, savePhotoAction, type ProfileFormState } from "@/app/dashboard/profile/actions";
import type { Profile } from "@/lib/profile";
import { Button } from "./ui/Button";
import { Input, Label } from "./ui/Input";
import { focusRing } from "./ui/focus";

const idle: ProfileFormState = { status: "idle" };

export function ProfilePhotoForm({ photoUrl }: { photoUrl: string | null }) {
  const [state, action, pending] = useActionState(savePhotoAction, idle);
  const error = state.status === "error" ? state.errors.photo : undefined;
  return (
    <div className="flex flex-wrap items-start gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- the host's own upload, served by our route */}
      {photoUrl ? <img src={photoUrl} alt="Your photo" width={96} height={96} className="h-24 w-24 rounded-full object-cover" />
        : <div aria-hidden className="h-24 w-24 rounded-full bg-surface" />}
      <form action={action} className="grid gap-2">
        <Label htmlFor="pf-photo">Photo (JPEG, PNG or WebP, up to 2 MB)</Label>
        <input id="pf-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" aria-invalid={error ? true : undefined}
          aria-describedby={error ? "pf-photo-error" : undefined} className={`text-sm text-text ${focusRing}`} />
        {error && <p id="pf-photo-error" className="text-sm text-danger">{error}</p>}
        {state.status === "saved" && <p role="status" className="text-sm text-success">Photo updated.</p>}
        <div className="flex gap-2">
          <Button type="submit" loading={pending}>Upload</Button>
          {photoUrl && <Button type="submit" variant="secondary" formAction={removePhotoAction}>Remove</Button>}
        </div>
      </form>
    </div>
  );
}

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(saveProfileAction, idle);
  const errors = state.status === "error" ? state.errors : {};
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <div><Label htmlFor="pf-headline">Headline</Label><Input id="pf-headline" name="headline" maxLength={120} defaultValue={profile.headline ?? ""} placeholder="Career coach for first-time managers" error={errors.headline} /></div>
      <div>
        <Label htmlFor="pf-bio">About you</Label>
        <textarea id="pf-bio" name="bio" rows={6} maxLength={2000} defaultValue={profile.bio ?? ""} aria-invalid={errors.bio ? true : undefined}
          className={`mt-1 block w-full rounded-md border bg-card px-3 py-2 text-base text-text ${errors.bio ? "border-danger" : "border-border-input"} ${focusRing}`} />
        {errors.bio && <p className="mt-1 text-sm text-danger">{errors.bio}</p>}
      </div>
      <div><Label htmlFor="pf-area">Where you work</Label><Input id="pf-area" name="area" maxLength={120} defaultValue={profile.area ?? ""} placeholder="Indiranagar, Bengaluru, or Online" error={errors.area} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="pf-wa">WhatsApp for clients</Label><Input id="pf-wa" name="whatsapp" inputMode="tel" defaultValue={profile.whatsapp ?? ""} placeholder="+91 98765 43210" error={errors.whatsapp} /></div>
        <div><Label htmlFor="pf-ig">Instagram</Label><Input id="pf-ig" name="instagram" defaultValue={profile.instagram ?? ""} placeholder="priya.coaching" error={errors.instagram} /></div>
      </div>
      <div>
        <Label htmlFor="pf-reviews">Google reviews link</Label>
        <Input id="pf-reviews" name="reviewsUrl" inputMode="url" defaultValue={profile.reviewsUrl ?? ""} placeholder="https://g.page/r/…" error={errors.reviewsUrl} aria-describedby="pf-reviews-hint" />
        <p id="pf-reviews-hint" className="mt-1 text-sm text-text-muted">In Google Maps, open your business, tap Share and paste the link. Your page shows a button to your reviews there.</p>
      </div>
      {errors.form && <p role="alert" className="text-danger">{errors.form}</p>}
      {state.status === "saved" && <p role="status" className="text-success">Saved. Your page is up to date.</p>}
      <div><Button type="submit" loading={pending}>Save</Button></div>
    </form>
  );
}
