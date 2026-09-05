"use client";

import { useState, FormEvent } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";

type Status = "idle" | "loading" | "success" | "error";

export default function Waitlist() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!isValidEmail(email)) {
      setStatus("error");
      return;
    }

    setStatus("loading");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) throw new Error("Failed to join waitlist");

      setStatus("success");
      setEmail("");
    } catch {
      setStatus("error");
    }
  };

  return (
    <section id="waitlist" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Join the Waitlist
          </h2>
          <p className="mt-4 text-lg text-zinc-400">
            Be the first to know when we launch. Get early access and exclusive perks.
          </p>
        </motion.div>

        <motion.form
          onSubmit={handleSubmit}
          className="mt-8 flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            placeholder="Enter your email address"
            disabled={status === "loading" || status === "success"}
            className={`flex-1 px-4 py-3 rounded-lg bg-zinc-900 border text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
              status === "error" ? "border-red-500" : "border-zinc-800"
            }`}
          />
          <Button
            type="submit"
            disabled={status === "loading" || status === "success"}
            className="bg-white text-black hover:bg-zinc-200 h-12 px-6"
          >
            {status === "loading" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Joining...
              </>
            ) : status === "success" ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Joined!
              </>
            ) : (
              "Join Waitlist"
            )}
          </Button>
        </motion.form>

        {status === "error" && (
          <motion.p
            className="mt-3 text-red-400 flex items-center justify-center gap-1 text-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <AlertCircle className="w-4 h-4" />
            {isValidEmail(email) ? "Something went wrong. Please try again." : "Please enter a valid email address."}
          </motion.p>
        )}

        {status === "success" && (
          <motion.p
            className="mt-3 text-green-400 flex items-center justify-center gap-1 text-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <CheckCircle className="w-4 h-4" />
            You&apos;re on the list! We&apos;ll be in touch soon.
          </motion.p>
        )}
      </div>
    </section>
  );
}
