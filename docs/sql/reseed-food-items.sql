-- Rebuild the LifeOS food database.
--
-- WARNING: this deletes every row in public.food_items, including user-created
-- foods. Existing meal logs and templates keep their copied name/macro values;
-- their old food_item_id references are cleared before foods are deleted.
--
-- Run this in the Supabase SQL Editor when you intentionally want a clean reseed.

begin;

create extension if not exists pgcrypto;

alter table public.food_items add column if not exists calories_per_100g numeric;
alter table public.food_items add column if not exists protein_per_100g numeric;
alter table public.food_items add column if not exists carbs_per_100g numeric;
alter table public.food_items add column if not exists fat_per_100g numeric;
alter table public.food_items add column if not exists fiber_per_100g numeric;
alter table public.food_items add column if not exists default_unit text;
alter table public.food_items add column if not exists calories_per_unit numeric;

update public.meal_log_items
set food_item_id = null
where food_item_id is not null;

update public.meal_template_items
set food_item_id = null
where food_item_id is not null;

delete from public.food_items;

with seed (
  name,
  calories_per_100g,
  protein_per_100g,
  carbs_per_100g,
  fat_per_100g,
  fiber_per_100g,
  default_unit,
  calories_per_unit
) as (
  values
    ('Punugulu', 275, 6.5, 26.0, 16.0, 1.8, 'piece', 41),
    ('Garelu / Minapa Garelu (Medu Vada)', 195, 7.2, 18.0, 10.5, 2.2, 'piece', 98),
    ('Chekkalu (rice crackers)', 485, 6.5, 58.0, 25.0, 2.5, 'piece', 73),
    ('Sajja Roti (Bajra flatbread)', 341, 11.0, 66.8, 4.9, 11.5, 'piece', 171),
    ('Jonna Rotte (Jowar flatbread)', 333, 10.0, 70.7, 2.7, 9.7, 'piece', 200),
    ('Ragi Sankati (Ragi Mudde, Telangana)', 119, 2.5, 25.0, 0.6, 3.5, 'g', null),
    ('Attu (Godhuma / Wheat Dosa)', 180, 4.5, 30.0, 5.0, 2.0, 'piece', 126),
    ('Sajjalu Annam (Pearl millet rice)', 132, 3.8, 26.5, 1.8, 4.5, 'g', null),
    ('Pulihora (Chintapandu / Tamarind rice)', 178, 3.0, 29.0, 5.5, 1.2, 'g', null),
    ('Perugu Annam (Curd rice)', 120, 3.5, 20.0, 2.8, 0.5, 'g', null),
    ('Gongura Pulihora', 170, 3.2, 27.0, 5.8, 2.0, 'g', null),
    ('Pulagam (Ugadi sweet pongal)', 185, 3.2, 33.0, 4.8, 1.0, 'g', null),
    ('Bagara Khana (Hyderabadi spiced rice)', 175, 3.0, 28.0, 6.0, 0.8, 'g', null),
    ('Kheema Pulao (Hyderabadi)', 215, 9.5, 24.0, 9.0, 1.0, 'g', null),
    ('Nimmakaya Pulihora (Lemon rice)', 165, 2.8, 27.0, 5.5, 1.0, 'g', null),
    ('Kobbari Annam (Coconut rice)', 195, 3.0, 27.0, 8.5, 1.5, 'g', null),
    ('Tomato Pappu', 98, 5.8, 13.5, 3.0, 4.0, 'g', null),
    ('Palakura Pappu (Spinach dal)', 95, 6.0, 12.5, 3.0, 4.5, 'g', null),
    ('Gongura Pappu', 105, 5.5, 13.0, 3.8, 4.2, 'g', null),
    ('Mamidikaya Pappu (Raw mango dal)', 100, 5.6, 14.0, 3.0, 4.0, 'g', null),
    ('Dosakaya Pappu (Yellow cucumber dal)', 92, 5.5, 12.0, 2.8, 4.0, 'g', null),
    ('Chukkakura Pappu (Sorrel leaves dal)', 98, 5.8, 12.5, 3.2, 4.5, 'g', null),
    ('Thotakura Pappu (Amaranth leaves dal)', 96, 6.0, 12.0, 3.0, 4.8, 'g', null),
    ('Menthikura Pappu (Fenugreek leaves dal)', 100, 6.2, 12.5, 3.2, 5.0, 'g', null),
    ('Ulavacharu (Horse gram curry)', 85, 6.5, 11.0, 2.0, 5.5, 'ml', null),
    ('Pesara Pappu Tadka (Andhra moong dal)', 105, 6.8, 15.0, 2.8, 4.0, 'g', null),
    ('Vankaya Kura (Brinjal curry)', 110, 2.0, 10.0, 7.0, 3.0, 'g', null),
    ('Bendakaya Kura (Okra curry)', 95, 2.2, 9.0, 6.0, 3.5, 'g', null),
    ('Dondakaya Kura (Ivy gourd curry)', 98, 1.8, 9.5, 6.2, 3.0, 'g', null),
    ('Beerakaya Kura (Ridge gourd curry)', 75, 1.5, 7.0, 5.0, 2.5, 'g', null),
    ('Chikkudukaya Kura (Broad beans curry)', 92, 2.5, 10.0, 5.5, 4.0, 'g', null),
    ('Aratikaya Kura (Raw banana curry)', 115, 1.8, 14.0, 6.0, 2.8, 'g', null),
    ('Kakarakaya Kura (Bitter gourd curry)', 85, 1.8, 8.0, 5.5, 3.2, 'g', null),
    ('Bachalakura Pappu (Malabar spinach dal)', 90, 4.5, 10.5, 3.5, 4.0, 'g', null),
    ('Cabbage Kura (Andhra style)', 80, 1.8, 8.5, 4.5, 2.5, 'g', null),
    ('Carrot Kura (Andhra style)', 85, 1.5, 10.0, 4.5, 2.8, 'g', null),
    ('Vankaya Fry (Brinjal fry)', 145, 2.0, 11.0, 10.5, 3.0, 'g', null),
    ('Senagapindi Vankaya (Gram-flour brinjal)', 150, 4.5, 14.0, 9.0, 3.5, 'g', null),
    ('Beans Kura (Cluster beans, Andhra style)', 88, 2.2, 9.0, 5.0, 3.5, 'g', null),
    ('Pachi Pulusu (Raw tamarind soup)', 45, 1.0, 8.0, 1.0, 1.0, 'ml', null),
    ('Mulakkada Kura (Drumstick curry)', 80, 2.2, 8.5, 4.5, 3.0, 'g', null),
    ('Kodi Kura (Andhra chicken curry)', 175, 15.0, 5.5, 11.0, 1.0, 'g', null),
    ('Natu Kodi Pulusu (Country chicken curry)', 190, 16.0, 6.0, 12.5, 1.0, 'g', null),
    ('Chicken 65', 240, 20.0, 8.0, 15.0, 0.5, 'g', null),
    ('Chicken Fry (Andhra style)', 220, 21.0, 6.0, 13.5, 0.8, 'g', null),
    ('Mamsam Kura (Mutton curry, Andhra)', 210, 15.5, 5.5, 14.5, 1.0, 'g', null),
    ('Royyala Iguru (Prawn curry)', 155, 15.0, 5.5, 8.5, 1.0, 'g', null),
    ('Royyala Vepudu (Fried prawns)', 180, 18.0, 5.0, 10.5, 0.5, 'g', null),
    ('Royyala Pulusu (Prawn tamarind curry)', 145, 14.5, 6.5, 7.0, 1.0, 'g', null),
    ('Chepala Pulusu (Andhra fish curry)', 135, 14.5, 5.0, 7.0, 1.0, 'g', null),
    ('Chepala Vepudu (Fried fish, Andhra)', 210, 20.0, 6.0, 12.5, 0.5, 'g', null),
    ('Kodi Vepudu (Chicken fry, dry)', 230, 22.0, 5.5, 14.0, 0.8, 'g', null),
    ('Gongura Mutton', 195, 14.0, 6.0, 13.0, 2.0, 'g', null),
    ('Gongura Chicken', 145, 13.0, 5.5, 8.5, 2.0, 'g', null),
    ('Egg Curry (Andhra style)', 160, 8.5, 6.5, 11.0, 1.2, 'g', null),
    ('Kheema Curry (Andhra style)', 205, 15.0, 5.5, 14.0, 1.0, 'g', null),
    ('Hyderabadi Mutton Biryani', 235, 9.0, 22.0, 12.5, 1.2, 'g', null),
    ('Hyderabadi Haleem', 160, 9.0, 16.0, 8.0, 2.5, 'g', null),
    ('Bone Soup / Paya (Hyderabadi)', 95, 9.0, 2.0, 5.5, 0.2, 'ml', null),
    ('Mutton Marag (Telangana soup)', 110, 10.0, 2.5, 6.5, 0.3, 'ml', null),
    ('Avakaya (Mango pickle)', 240, 1.5, 16.0, 20.0, 3.0, 'tbsp', 36),
    ('Gongura Pachadi', 95, 2.5, 8.0, 6.5, 3.5, 'tbsp', 14),
    ('Tomato Pachadi', 110, 2.0, 9.0, 8.0, 2.0, 'tbsp', 17),
    ('Allam Pachadi (Ginger chutney)', 130, 2.5, 14.0, 8.0, 2.5, 'tbsp', 20),
    ('Kobbari Pachadi (Coconut chutney)', 210, 4.0, 8.0, 19.0, 4.0, 'tbsp', 32),
    ('Pudina Chutney (Mint)', 70, 3.0, 8.0, 3.5, 3.0, 'tbsp', 11),
    ('Nimmakaya Pachadi (Lemon pickle)', 180, 1.5, 20.0, 12.0, 4.0, 'tbsp', 27),
    ('Usirikaya Pachadi (Gooseberry pickle)', 160, 1.2, 22.0, 8.0, 5.0, 'tbsp', 24),
    ('Palli Chutney (Peanut chutney)', 290, 12.0, 14.0, 22.0, 6.0, 'tbsp', 44),
    ('Karivepaku Podi (Curry leaves powder)', 380, 18.0, 35.0, 22.0, 10.0, 'tbsp', 38),
    ('Nuvvula Podi (Sesame seed powder)', 470, 18.0, 22.0, 38.0, 10.0, 'tbsp', 47),
    ('Kandi Podi (Toor dal powder)', 420, 20.0, 42.0, 20.0, 10.0, 'tbsp', 42),
    ('Ariselu', 440, 3.5, 62.0, 19.0, 1.0, 'piece', 132),
    ('Pootharekulu', 420, 5.0, 58.0, 18.0, 1.0, 'piece', 105),
    ('Sakinalu', 500, 7.0, 52.0, 28.0, 2.5, 'g', null),
    ('Boorelu (sweet stuffed fried dumpling)', 410, 6.0, 55.0, 18.0, 2.0, 'piece', 144),
    ('Sunnundalu (Urad dal laddu)', 480, 10.0, 48.0, 26.0, 4.0, 'piece', 96),
    ('Semiya Payasam (Vermicelli kheer)', 150, 3.5, 22.0, 5.5, 0.5, 'g', null),
    ('Janthikalu (Telugu murukku)', 510, 8.0, 52.0, 30.0, 3.0, 'g', null),
    ('Double Ka Meetha (Hyderabadi bread pudding)', 320, 5.5, 38.0, 16.0, 1.0, 'g', null),
    ('Qubani Ka Meetha (Apricot dessert)', 180, 2.0, 35.0, 4.0, 3.0, 'g', null),
    ('Gavvalu (Sweet shell pasta)', 430, 5.0, 60.0, 19.0, 1.5, 'g', null),
    ('Kaja (Layered fried sweet)', 480, 4.5, 58.0, 25.0, 1.0, 'piece', 120),
    ('Sheer Khurma (Hyderabadi vermicelli milk dessert)', 185, 4.5, 22.0, 8.5, 0.8, 'g', null),
    ('Masala Vada (Bobbarlu vada)', 240, 8.0, 22.0, 13.0, 4.0, 'piece', 96),
    ('Aloo Bonda (Andhra style)', 255, 4.5, 28.0, 14.0, 2.0, 'piece', 102),
    ('Majjiga (Spiced buttermilk)', 28, 2.0, 3.0, 1.0, 0.0, 'ml', null),
    ('Majjiga Pulusu (Buttermilk curry)', 55, 2.5, 5.5, 2.5, 1.0, 'ml', null),
    ('Ragi Java / Ambali (Ragi porridge)', 70, 1.8, 14.0, 0.5, 2.0, 'ml', null),
    ('Korralu Annam (Foxtail millet rice)', 128, 3.7, 26.0, 1.5, 4.2, 'g', null),
    ('Mulakkada Sambar (Drumstick sambar)', 58, 2.8, 9.0, 1.2, 2.5, 'ml', null),
    ('Bandakaya Pulusu (Okra tamarind curry)', 85, 2.0, 9.5, 4.5, 3.2, 'g', null),
    ('Aratikaya Bajji (Raw banana fritters)', 265, 3.5, 32.0, 14.0, 2.5, 'piece', 80),
    ('Vankaya Pachadi (Roasted brinjal chutney)', 125, 2.5, 9.0, 9.0, 2.5, 'tbsp', 19),
    ('Tahari (Hyderabadi veg pulao)', 165, 3.5, 27.0, 5.0, 2.0, 'g', null),
    ('Ven Pongal', 150, 4.5, 24.0, 4.0, 1.0, 'g', null),
    ('Rava Dosa', 210, 3.5, 30.0, 8.5, 1.0, 'piece', 126),
    ('Uttapam (Onion)', 160, 4.0, 24.0, 5.0, 1.5, 'piece', 144),
    ('Thayir Vadai (Curd vada)', 140, 5.5, 15.0, 6.0, 1.5, 'piece', 84),
    ('Vatha Kuzhambu', 70, 2.5, 9.0, 3.0, 2.5, 'ml', null),
    ('Kara Kuzhambu', 80, 2.8, 9.5, 3.8, 2.5, 'ml', null),
    ('Aviyal', 95, 2.5, 10.0, 5.0, 3.5, 'g', null),
    ('Poriyal (Mixed vegetable)', 85, 2.5, 8.5, 5.0, 3.0, 'g', null),
    ('Adai (Lentil dosa)', 185, 7.0, 27.0, 5.5, 3.5, 'piece', 130),
    ('Chettinad Chicken Curry', 200, 16.0, 6.0, 13.0, 1.2, 'g', null),
    ('Filter Coffee (with milk)', 55, 1.5, 7.0, 2.0, 0.0, 'ml', null),
    ('Murukku', 510, 7.5, 53.0, 29.0, 2.5, 'piece', 77),
    ('Sambar Rice', 125, 3.5, 22.0, 2.5, 2.0, 'g', null),
    ('Appam', 155, 2.8, 29.0, 2.8, 0.8, 'piece', 78),
    ('Puttu', 150, 3.2, 29.0, 2.5, 2.0, 'piece', 90),
    ('Kerala Parotta', 320, 6.0, 48.0, 12.0, 1.5, 'piece', 256),
    ('Fish Moilee', 145, 14.0, 4.5, 8.5, 0.8, 'g', null),
    ('Kerala Fish Curry', 130, 14.5, 4.0, 7.0, 1.0, 'g', null),
    ('Cabbage Thoran', 95, 2.5, 8.0, 6.0, 3.0, 'g', null),
    ('Erissery (Pumpkin-lentil curry)', 110, 3.0, 14.0, 5.0, 3.5, 'g', null),
    ('Olan', 70, 1.8, 7.0, 4.0, 2.5, 'g', null),
    ('Kerala Egg Roast', 175, 9.0, 6.5, 12.0, 1.0, 'g', null),
    ('Ada Pradhaman', 200, 3.0, 28.0, 9.0, 0.8, 'g', null),
    ('Banana Chips (Kerala)', 520, 2.5, 58.0, 32.0, 3.5, 'g', null),
    ('Kerala Chicken Curry', 180, 15.5, 5.5, 11.0, 1.0, 'g', null),
    ('Bisi Bele Bath', 150, 4.5, 23.0, 5.0, 2.5, 'g', null),
    ('Ragi Mudde (Karnataka style)', 115, 2.3, 24.0, 0.6, 3.2, 'g', null),
    ('Mysore Pak', 550, 5.0, 58.0, 32.0, 1.0, 'piece', 138),
    ('Mangalore Buns', 265, 5.0, 42.0, 9.0, 1.5, 'piece', 159),
    ('Akki Roti', 175, 3.5, 32.0, 4.0, 2.5, 'piece', 123),
    ('Davangere Benne Dosa', 240, 3.5, 28.0, 13.0, 1.0, 'piece', 216),
    ('Maddur Vada', 290, 5.5, 35.0, 15.0, 2.0, 'piece', 131),
    ('Kesari Bath', 290, 3.0, 42.0, 12.0, 0.5, 'g', null),
    ('Mysore Bonda', 300, 5.0, 35.0, 16.0, 1.5, 'piece', 90),
    ('Neer Dosa', 120, 2.0, 24.0, 1.5, 0.5, 'piece', 72),
    ('Mangalorean Fish Curry', 150, 14.0, 5.5, 9.0, 1.2, 'g', null),
    ('Vangi Bath', 175, 3.5, 27.0, 6.5, 2.5, 'g', null),
    ('Naan (plain)', 290, 9.0, 50.0, 6.0, 2.0, 'piece', 261),
    ('Paratha (plain)', 290, 6.5, 42.0, 11.0, 4.0, 'piece', 174),
    ('Aloo Paratha', 245, 5.8, 35.0, 9.0, 3.0, 'piece', 221),
    ('Puri / Poori', 330, 6.0, 38.0, 18.0, 1.5, 'piece', 83),
    ('Kulcha', 310, 8.5, 50.0, 8.5, 2.0, 'piece', 248),
    ('Dal Makhani', 135, 5.5, 13.0, 7.0, 4.0, 'g', null),
    ('Dal Tadka', 110, 6.0, 15.0, 3.5, 4.5, 'g', null),
    ('Chana Masala', 165, 7.5, 20.0, 6.5, 6.5, 'g', null),
    ('Rajma Masala', 140, 7.5, 18.0, 5.0, 6.0, 'g', null),
    ('Aloo Gobi', 110, 2.5, 13.0, 6.0, 3.0, 'g', null),
    ('Baingan Bharta', 105, 2.0, 9.5, 6.5, 3.5, 'g', null),
    ('Bhindi Masala', 100, 2.2, 9.5, 6.0, 3.5, 'g', null),
    ('Palak Paneer', 165, 8.0, 8.0, 11.0, 3.0, 'g', null),
    ('Paneer Butter Masala', 215, 9.0, 9.5, 16.0, 1.5, 'g', null),
    ('Sarson Ka Saag', 95, 4.0, 8.0, 5.5, 4.0, 'g', null),
    ('Butter Chicken', 195, 14.0, 6.0, 13.0, 1.0, 'g', null),
    ('Chicken Tikka', 180, 24.0, 3.0, 8.0, 0.5, 'g', null),
    ('Chicken Curry (Punjabi)', 180, 15.5, 6.0, 11.0, 1.0, 'g', null),
    ('Mutton Rogan Josh', 220, 15.0, 6.5, 15.0, 1.0, 'g', null),
    ('Tandoori Chicken', 165, 25.0, 2.5, 6.5, 0.3, 'g', null),
    ('Seekh Kebab (Mutton)', 240, 18.0, 4.0, 17.0, 0.8, 'piece', 120),
    ('Jeera Rice', 185, 3.0, 32.0, 5.0, 0.8, 'g', null),
    ('Veg Pulao', 160, 3.5, 26.0, 5.0, 2.0, 'g', null),
    ('Samosa (Aloo)', 295, 5.0, 32.0, 17.0, 2.0, 'piece', 148),
    ('Pakora (Onion bhaji)', 315, 6.5, 28.0, 20.0, 3.0, 'piece', 79),
    ('Pav Bhaji', 160, 4.0, 22.0, 6.5, 3.0, 'g', null),
    ('Aloo Tikki', 200, 3.5, 26.0, 10.0, 2.5, 'piece', 100),
    ('Chole (Punjabi curry)', 160, 7.5, 20.0, 6.0, 6.5, 'g', null),
    ('Bhature', 315, 7.0, 43.0, 13.0, 1.8, 'piece', 252),
    ('Pani Puri (with water & filling)', 150, 3.0, 24.0, 5.0, 2.0, 'g', null),
    ('Gulab Jamun', 320, 5.5, 48.0, 13.0, 0.5, 'piece', 128),
    ('Jalebi', 345, 4.0, 55.0, 14.0, 0.8, 'piece', 104),
    ('Besan Ladoo', 460, 8.5, 52.0, 24.0, 3.0, 'piece', 115),
    ('Kheer (Rice pudding)', 140, 3.5, 20.0, 5.0, 0.3, 'g', null),
    ('Rasgulla', 186, 4.0, 33.0, 4.0, 0.2, 'piece', 74)
),
normalized as (
  select
    *,
    case
      when calories_per_unit is not null and calories_per_100g > 0
        then calories_per_unit / calories_per_100g
      else 1
    end as unit_ratio
  from seed
)
insert into public.food_items (
  id,
  user_id,
  name,
  serving,
  unit,
  calories,
  protein,
  carbs,
  fat,
  calories_per_100g,
  protein_per_100g,
  carbs_per_100g,
  fat_per_100g,
  fiber_per_100g,
  default_unit,
  calories_per_unit
)
select
  gen_random_uuid(),
  null,
  name,
  case
    when calories_per_unit is not null then '1 ' || default_unit
    when default_unit = 'ml' then '100ml'
    else '100g'
  end,
  default_unit,
  coalesce(calories_per_unit, calories_per_100g),
  round((protein_per_100g * unit_ratio)::numeric, 1),
  round((carbs_per_100g * unit_ratio)::numeric, 1),
  round((fat_per_100g * unit_ratio)::numeric, 1),
  calories_per_100g,
  protein_per_100g,
  carbs_per_100g,
  fat_per_100g,
  fiber_per_100g,
  default_unit,
  calories_per_unit
from normalized;

commit;

select count(*) as food_items_seeded from public.food_items;
