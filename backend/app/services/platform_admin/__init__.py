"""Platform administration (SUPER_ADMIN): cross-cooperative listings, details and decisions.

Each module backs one area of /api/v1/superadmin. Rules that also apply inside a cooperative (creating a farmer,
changing a cooler...) stay in the cooperative-side services; these modules add the platform-wide views on top.
Rows are looked up with app.services.principal.get_or_404 (any cooperative).
"""
