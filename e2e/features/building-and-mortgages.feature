Feature: Building and mortgages
  Whoever owns all streets of a colour group may build:
  houses evenly, then a hotel, then a skyscraper.

  Background:
    Given Anna and Ben play a game in Switzerland
    And Anna already owns "Weggisgasse", "Pilatusstrasse" and "Kapellbrücke"
    And it is Anna's turn and the dice have been rolled

  Scenario: Houses are built evenly
    When Anna builds on "Weggisgasse"
    Then Anna has 1 house on "Weggisgasse"
    And Anna has a balance of 1'950
    And Anna cannot build on "Weggisgasse"
    And Anna can build on "Pilatusstrasse"
    When Anna builds on "Pilatusstrasse"
    And Anna builds on "Kapellbrücke"
    Then Anna can build on "Weggisgasse"

  Scenario: Four houses are upgraded to a hotel
    Given on "Weggisgasse", "Pilatusstrasse" and "Kapellbrücke" there are 4 houses
    When Anna builds on "Weggisgasse"
    Then Anna has a hotel on "Weggisgasse"
    And Anna cannot build on "Weggisgasse"

  Scenario: The skyscraper only comes once all streets of the group have a hotel
    Given on "Weggisgasse" and "Pilatusstrasse" there is a hotel
    And on "Kapellbrücke" there are 4 houses
    When Anna opens the property card of "Weggisgasse"
    Then the button "Wolkenkratzer bauen" in the property card of Anna is disabled
    And Anna closes the property card
    And Anna builds on "Kapellbrücke"
    Then Anna has a hotel on "Kapellbrücke"
    When Anna opens the property card of "Weggisgasse"
    Then the button "Wolkenkratzer bauen" in the property card of Anna is enabled
    When Anna taps "Wolkenkratzer bauen" in the property card
    Then Anna has a skyscraper on "Weggisgasse"

  Scenario: Anna takes out a mortgage and repays it
    When Anna takes out a mortgage on "Kapellbrücke"
    Then "Kapellbrücke" of Anna is mortgaged
    And Anna has a balance of 2'060
    When Anna repays the mortgage on "Kapellbrücke"
    Then "Kapellbrücke" of Anna is not mortgaged
    And Anna has a balance of 1'994
