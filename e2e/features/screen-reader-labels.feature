Feature: Screen reader labels
  What colour, a tooltip or a ticking clock shows to the eye must also reach screen readers:
  the turn is announced once, the countdown is not announced every half second, and presence
  and colour-group stamps have a text equivalent.

  Background:
    Given Anna and Ben play a game in Switzerland with a time limit of 60 seconds
    And it is Anna's turn

  @desktop
  Scenario: The turn is announced but the ticking countdown stays outside of the live region
    Then the turn banner of Anna announces "Anna ist am Zug" as a status
    And the countdown of Anna is a timer outside of every live region

  Scenario: The presence dot names the state of each player
    Then Anna sees that Ben is "online"
    When Ben closes the game page
    Then Anna sees that Ben is "offline"

  Scenario: Colour-group stamps name the group and the owned streets
    Given Anna already owns "Weggisgasse"
    Then Anna sees the stamp "Luzern: 1/3" on Anna
    Given Anna already owns "Weggisgasse", "Pilatusstrasse" and "Kapellbrücke"
    Then Anna sees the stamp "Luzern: 3/3 · Farbset" on Anna
